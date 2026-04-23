import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Neon's WebSocket driver needs a WebSocket constructor in Node. Edge/browser
// runtimes have it natively.
if (typeof WebSocket === "undefined") {
	neonConfig.webSocketConstructor = ws;
}

/**
 * We maintain two pools with two different DB roles:
 *
 *   - `pool`      connects as `vcts_app`. NO BYPASSRLS - Postgres enforces
 *                 tenant isolation. Used by every runtime query that comes
 *                 from an authenticated tenant user.
 *
 *   - `adminPool` connects as `neondb_owner` (Neon's default, BYPASSRLS on).
 *                 Used only by auth flows that need to look up users before
 *                 a tenant is known, by migrations, and by the seed script.
 *
 * Swap the `username` / `password` on the owner URL to derive the app URL so
 * the user only has to configure ONE Neon connection plus APP_DB_PASSWORD.
 */
function deriveAppUrl(ownerUrl: string, password: string): string {
	const u = new URL(ownerUrl);
	u.username = "vcts_app";
	u.password = password;
	return u.toString();
}

type Globals = { __vctsPool?: Pool; __vctsAdminPool?: Pool };
const g = globalThis as unknown as Globals;

export const pool =
	g.__vctsPool ??
	new Pool({ connectionString: deriveAppUrl(env.DATABASE_URL, env.APP_DB_PASSWORD) });

export const adminPool =
	g.__vctsAdminPool ?? new Pool({ connectionString: env.DATABASE_URL });

if (env.NODE_ENV !== "production") {
	g.__vctsPool = pool;
	g.__vctsAdminPool = adminPool;
}

export const db = drizzle(pool, { schema });
export const adminDb = drizzle(adminPool, { schema });
export { schema };
