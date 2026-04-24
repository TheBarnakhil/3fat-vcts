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
const EnvSchema = z.object({
	DATABASE_URL: z.string().url(),
	DATABASE_URL_UNPOOLED: z.string().url(),
	JWT_PRIVATE_KEY_BASE64: z.string().min(1),
	JWT_PUBLIC_KEY_BASE64: z.string().min(1),
	JWT_ACCESS_EXPIRES_IN: z.string().default("8h"),
	JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
	PASSWORD_PEPPER: z.string().min(16),
	AUDIT_HMAC_SECRET: z.string().min(16),
	APP_DB_PASSWORD: z.string().min(16),
	MAPS_API_KEY: z.string().min(1).optional(),
	NEXT_PUBLIC_MAPS_API_KEY: z.string().min(1).optional(),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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
