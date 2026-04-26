import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "./env";

/**
 * Per-(tenant, agent) sliding-window rate limit for collection writes.
 *
 * Backed by Upstash Redis when the project's KV env vars are present (the
 * Vercel-Upstash integration sets them automatically). When they're missing
 * we fall back to a tiny in-process token bucket so local dev still throttles
 * obviously-runaway loops; that fallback is per-process and not safe across
 * lambda invocations - never rely on it in prod.
 */

let memo:
	| { kind: "upstash"; rl: Ratelimit }
	| { kind: "memory"; buckets: Map<string, { count: number; resetAt: number }> }
	| null = null;

function getLimiter(): NonNullable<typeof memo> {
	if (memo) return memo;

	const url = env.UPSTASH_REDIS_KV_REST_API_URL;
	const token = env.UPSTASH_REDIS_KV_REST_API_TOKEN;

	if (url && token) {
		const redis = new Redis({ url, token });
		const rl = new Ratelimit({
			redis,
			limiter: Ratelimit.slidingWindow(
				env.COLLECTIONS_RATE_PER_MIN,
				"1 m",
			),
			analytics: false,
			prefix: "vcts:rl:collections",
		});
		memo = { kind: "upstash", rl };
		return memo;
	}

	if (env.NODE_ENV === "production") {
		console.warn(
			"[rate-limit] Upstash env vars missing in production; using in-memory fallback (NOT cross-instance safe).",
		);
	}
	memo = { kind: "memory", buckets: new Map() };
	return memo;
}

export type RateLimitResult = {
	success: boolean;
	limit: number;
	remaining: number;
	resetSeconds: number; // seconds until the window resets
};

/**
 * Check + spend one token for `tenantId:agentId`. Returns whether the request
 * may proceed and metadata you can put in `X-RateLimit-*` response headers.
 */
export async function limitCollections(
	tenantId: string,
	agentId: string,
): Promise<RateLimitResult> {
	const limiter = getLimiter();
	const key = `${tenantId}:${agentId}`;
	const limit = env.COLLECTIONS_RATE_PER_MIN;

	if (limiter.kind === "upstash") {
		const r = await limiter.rl.limit(key);
		return {
			success: r.success,
			limit: r.limit,
			remaining: r.remaining,
			resetSeconds: Math.max(
				0,
				Math.ceil((r.reset - Date.now()) / 1000),
			),
		};
	}

	const now = Date.now();
	const entry = limiter.buckets.get(key);
	if (!entry || entry.resetAt <= now) {
		limiter.buckets.set(key, { count: 1, resetAt: now + 60_000 });
		return {
			success: true,
			limit,
			remaining: limit - 1,
			resetSeconds: 60,
		};
	}
	entry.count += 1;
	const success = entry.count <= limit;
	return {
		success,
		limit,
		remaining: Math.max(0, limit - entry.count),
		resetSeconds: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
	};
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
