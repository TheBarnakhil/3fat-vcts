import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js loads .env.local at runtime, but drizzle-kit is a CLI - load it here.
loadEnv({ path: [".env.local", ".env"] });

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		// Migrations go via the unpooled URL - direct session, no pgbouncer.
		url: process.env.DATABASE_URL_UNPOOLED!,
	},
	verbose: false,
	strict: false,
});
