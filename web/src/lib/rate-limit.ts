import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "./env";

/**
 * Per-bucket sliding-window rate limiter.
 *
 * Backed by Upstash Redis when the project's KV env vars are present (the
 * Vercel-Upstash integration sets them automatically). When they're missing
 * we fall back to a tiny in-process token bucket so local dev still throttles
 * obviously-runaway loops; that fallback is per-process and not safe across
 * lambda invocations - never rely on it in prod.
 *
 * Each named bucket gets its own Upstash `Ratelimit` instance so the prefix
 * + per-bucket limit are isolated. The key is whatever uniquely identifies
 * the rate-limited subject (tenant + agent, IP, email, etc.).
 */

export type BucketName =
	| "collections"
	| "loginIp"
	| "loginEmail"
	| "attachments"
	| "syncPush"
	| "locationLogs"
	| "geocode"
	| "tenantBranding";

type BucketSpec = {
	limit: number;
	prefix: string;
};

function specs(): Record<BucketName, BucketSpec> {
	return {
		collections: { limit: env.COLLECTIONS_RATE_PER_MIN, prefix: "vcts:rl:collections" },
		loginIp: { limit: env.LOGIN_IP_RATE_PER_MIN, prefix: "vcts:rl:login-ip" },
		loginEmail: { limit: env.LOGIN_EMAIL_RATE_PER_MIN, prefix: "vcts:rl:login-email" },
		attachments: { limit: env.ATTACHMENT_RATE_PER_MIN, prefix: "vcts:rl:attachments" },
		syncPush: { limit: env.SYNC_PUSH_RATE_PER_MIN, prefix: "vcts:rl:sync-push" },
		locationLogs: { limit: env.LOCATION_LOG_RATE_PER_MIN, prefix: "vcts:rl:location-logs" },
		geocode: { limit: env.GEOCODE_RATE_PER_MIN, prefix: "vcts:rl:geocode" },
		tenantBranding: {
			limit: env.TENANT_BRANDING_RATE_PER_MIN,
			prefix: "vcts:rl:tenant-branding",
		},
	};
}

type UpstashLimiter = { kind: "upstash"; rl: Ratelimit; limit: number };
type MemoryLimiter = {
	kind: "memory";
	limit: number;
	buckets: Map<string, { count: number; resetAt: number }>;
};
type Limiter = UpstashLimiter | MemoryLimiter;

let redis: Redis | null = null;
let warnedAboutFallback = false;
const cache = new Map<BucketName, Limiter>();

function getRedis(): Redis | null {
	if (redis) return redis;
	const url = env.UPSTASH_REDIS_KV_REST_API_URL;
	const token = env.UPSTASH_REDIS_KV_REST_API_TOKEN;
	if (!url || !token) return null;
	redis = new Redis({ url, token });
	return redis;
}

function getLimiter(bucket: BucketName): Limiter {
	const memo = cache.get(bucket);
	if (memo) return memo;

	const spec = specs()[bucket];
	const r = getRedis();
	if (r) {
		const rl = new Ratelimit({
			redis: r,
			limiter: Ratelimit.slidingWindow(spec.limit, "1 m"),
			analytics: false,
			prefix: spec.prefix,
		});
		const next: Limiter = { kind: "upstash", rl, limit: spec.limit };
		cache.set(bucket, next);
		return next;
	}

	if (env.NODE_ENV === "production" && !warnedAboutFallback) {
		console.warn(
			"[rate-limit] Upstash env vars missing in production; using in-memory fallback (NOT cross-instance safe).",
		);
		warnedAboutFallback = true;
	}
	const next: Limiter = {
		kind: "memory",
		limit: spec.limit,
		buckets: new Map(),
	};
	cache.set(bucket, next);
	return next;
}

export type RateLimitResult = {
	success: boolean;
	limit: number;
	remaining: number;
	resetSeconds: number;
};

/** Generic check + spend against a named bucket. */
export async function limit(
	bucket: BucketName,
	key: string,
): Promise<RateLimitResult> {
	const limiter = getLimiter(bucket);

	if (limiter.kind === "upstash") {
		const r = await limiter.rl.limit(key);
		return {
			success: r.success,
			limit: r.limit,
			remaining: r.remaining,
			resetSeconds: Math.max(0, Math.ceil((r.reset - Date.now()) / 1000)),
		};
	}

	const now = Date.now();
	const entry = limiter.buckets.get(key);
	if (!entry || entry.resetAt <= now) {
		limiter.buckets.set(key, { count: 1, resetAt: now + 60_000 });
		return {
			success: true,
			limit: limiter.limit,
			remaining: limiter.limit - 1,
			resetSeconds: 60,
		};
	}
	entry.count += 1;
	const success = entry.count <= limiter.limit;
	return {
		success,
		limit: limiter.limit,
		remaining: Math.max(0, limiter.limit - entry.count),
		resetSeconds: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
	};
}

// --- Convenience wrappers (one per call-site so the keys stay consistent) ---

export function limitCollections(tenantId: string, agentId: string) {
	return limit("collections", `${tenantId}:${agentId}`);
}

export function limitLoginIp(ip: string) {
	return limit("loginIp", `ip:${ip || "unknown"}`);
}

export function limitLoginEmail(email: string) {
	return limit("loginEmail", `email:${email.toLowerCase()}`);
}

export function limitAttachments(tenantId: string, userId: string) {
	return limit("attachments", `${tenantId}:${userId}`);
}

export function limitSyncPush(tenantId: string, agentId: string) {
	return limit("syncPush", `${tenantId}:${agentId}`);
}

export function limitLocationLogs(tenantId: string, agentId: string) {
	return limit("locationLogs", `${tenantId}:${agentId}`);
}

export function limitGeocode(tenantId: string, userId: string) {
	return limit("geocode", `${tenantId}:${userId}`);
}

export function limitTenantBranding(tenantId: string) {
	return limit("tenantBranding", `${tenantId}`);
}

/** Convenience: turn a result into the four standard response headers. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
	return {
		"X-RateLimit-Limit": String(r.limit),
		"X-RateLimit-Remaining": String(r.remaining),
		"X-RateLimit-Reset": String(r.resetSeconds),
		...(r.success ? {} : { "Retry-After": String(r.resetSeconds) }),
	};
}
