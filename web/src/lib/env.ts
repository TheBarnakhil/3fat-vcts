import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// In Node-only contexts (scripts, tsx) we need to load .env.local manually;
// Next.js already populates process.env at runtime. Idempotent + harmless
// if the files don't exist.
if (typeof process !== "undefined" && !process.env.__VCTS_ENV_LOADED) {
	loadDotenv({ path: [".env.local", ".env"] });
	process.env.__VCTS_ENV_LOADED = "1";
}

/**
 * Validated process.env. Fail fast at module load rather than producing
 * confusing runtime errors deeper in the stack.
 */
// `.default()` only applies when the value is `undefined`, but Vercel and other
// hosts can materialise an empty string for a configured-but-blank variable.
// Pre-process to coerce "" (and whitespace-only) to undefined so defaults and
// `.optional()` behave intuitively.
const emptyToUndef = (v: unknown) =>
	typeof v === "string" && v.trim() === "" ? undefined : v;

// jose's `setExpirationTime` accepts formats like "8h", "30d", "15 min", or a
// number of seconds. Validate here so a bad value fails fast at boot instead
// of deep inside a signing call.
const durationSpec = z
	.string()
	.regex(/^\d+\s?(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|w|week|weeks)$/i, {
		message: "Expected a duration like '8h', '30d', or '15 min'.",
	});

const EnvSchema = z.object({
	DATABASE_URL: z.string().url(),
	DATABASE_URL_UNPOOLED: z.string().url(),
	JWT_PRIVATE_KEY_BASE64: z.string().min(1),
	JWT_PUBLIC_KEY_BASE64: z.string().min(1),
	JWT_ACCESS_EXPIRES_IN: z.preprocess(emptyToUndef, durationSpec.default("8h")),
	JWT_REFRESH_EXPIRES_IN: z.preprocess(emptyToUndef, durationSpec.default("30d")),
	PASSWORD_PEPPER: z.string().min(16),
	AUDIT_HMAC_SECRET: z.string().min(16),
	APP_DB_PASSWORD: z.string().min(16),
	MAPS_API_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
	NEXT_PUBLIC_MAPS_API_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

	// --- R2 / receipts (Phase 3). Optional in dev; if all four core values are
	// present we upload to R2, otherwise we stream PDFs straight from the API.
	R2_ACCOUNT_ID: z.preprocess(emptyToUndef, z.string().min(1).optional()),
	R2_ACCESS_KEY_ID: z.preprocess(emptyToUndef, z.string().min(1).optional()),
	R2_SECRET_ACCESS_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
	R2_BUCKET: z.preprocess(emptyToUndef, z.string().min(1).optional()),
	R2_PUBLIC_BASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),

	// --- Upstash Redis (used for per-tenant rate limiting). If absent we
	// degrade to in-memory limiting in dev and a no-op warning in prod.
	UPSTASH_REDIS_KV_REST_API_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
	UPSTASH_REDIS_KV_REST_API_TOKEN: z.preprocess(emptyToUndef, z.string().min(1).optional()),

	// --- Collections tuning (overridable per environment)
	COLLECTIONS_RATE_PER_MIN: z.coerce.number().int().min(1).max(120).default(10),
	GPS_MAX_ACCURACY_M: z.coerce.number().min(5).max(500).default(50),
	RECEIPT_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),

	// --- Phase 10: rate-limit budgets. All buckets are 1-minute sliding
	// windows backed by Upstash Redis (or an in-memory fallback in dev). The
	// numbers below are deliberately generous to avoid annoying real users
	// while still throttling obvious misuse / credential stuffing.
	LOGIN_IP_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).default(20),
	LOGIN_EMAIL_RATE_PER_MIN: z.coerce.number().int().min(1).max(60).default(5),
	ATTACHMENT_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).default(60),
	SYNC_PUSH_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).default(60),
	LOCATION_LOG_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).default(60),
	GEOCODE_RATE_PER_MIN: z.coerce.number().int().min(1).max(600).default(60),
	TENANT_BRANDING_RATE_PER_MIN: z.coerce.number().int().min(1).max(60).default(10),

	// --- Phase 7: location logging + visit validation
	// Vercel Cron forwards Authorization: Bearer <CRON_SECRET>. Optional in
	// dev so the route can be hit from a local terminal without a secret;
	// prod is checked at runtime when set, see api/cron/visits/recompute.
	CRON_SECRET: z.preprocess(emptyToUndef, z.string().min(16).optional()),
	VISIT_MIN_DWELL_SECONDS: z.coerce.number().int().min(30).max(3600).default(180),
	VISIT_RECOMPUTE_LOOKBACK_MIN: z.coerce.number().int().min(15).max(1440).default(60),
	VISIT_COLLECTION_TOLERANCE_MIN: z.coerce.number().int().min(1).max(60).default(5),

	// --- Phase 8: public verification URL embedded in QR codes / share text.
	// On Vercel this is the production domain (e.g. `https://example.com`);
	// when unset the receipt route falls back to a relative `/r/...` link
	// which still works inside the admin portal but is unhappy in PDFs.
	PUBLIC_BASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
	NEXT_PUBLIC_PUBLIC_BASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),

	// --- Phase 11: self-serve signup email verification. If RESEND_API_KEY and
	// SIGNUP_FROM_EMAIL are present, signup verification links are emailed.
	// Otherwise dev/test responses include the link for local verification.
	RESEND_API_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
	SIGNUP_FROM_EMAIL: z.preprocess(emptyToUndef, z.string().email().optional()),
});

function load(): z.infer<typeof EnvSchema> {
	const parsed = EnvSchema.safeParse(process.env);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  - ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(
			`Invalid environment variables:\n${issues}\n\nDid you copy .env.example to .env.local and run \`pnpm keys:generate\`?`,
		);
	}
	return parsed.data;
}

export const env = load();
export type Env = typeof env;
