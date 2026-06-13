/**
 * Provisions RLS for multi-tenant isolation. Idempotent; run after every
 * `pnpm db:push` and again whenever you add a new tenant-scoped table.
 *
 *   pnpm db:rls
 *
 * What it does:
 *   1. Creates (or alters) a non-superuser DB role `vcts_app` whose password
 *      lives in APP_DB_PASSWORD. Crucially it does NOT have BYPASSRLS, so
 *      Postgres actually enforces policies against it.
 *   2. Grants the minimum privileges vcts_app needs on the public schema.
 *   3. On every tenant-scoped table: ENABLE + FORCE RLS, then (re)creates the
 *      `tenant_isolation` policy - a single permissive policy that requires
 *        tenant_id = current_setting('app.tenant_id')::uuid
 *      for both SELECT/UPDATE (USING) and INSERT/UPDATE (WITH CHECK).
 *
 * Auth endpoints (/login, /refresh) need to look up users before a tenant
 * context exists. They connect as neondb_owner (BYPASSRLS) via withoutTenant().
 * All other runtime queries connect as vcts_app via withTenant() + the tenant
 * id from the JWT.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { neon } from "@neondatabase/serverless";

const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
const appPassword = process.env.APP_DB_PASSWORD;
if (!ownerUrl) {
	console.error("DATABASE_URL_UNPOOLED is not set. Check .env.local.");
	process.exit(1);
}
if (!appPassword) {
	console.error(
		"APP_DB_PASSWORD is not set. Run `pnpm keys:generate` and paste the APP_DB_PASSWORD line into .env.local.",
	);
	process.exit(1);
}

const sql = neon(ownerUrl);

const TENANT_TABLES = [
	"customers",
	"collections",
	"collection_reversals",
	"receipt_counters",
	"location_logs",
	"customer_visits",
	"audit_trail",
	"sync_queue",
	"supervisor_reviews",
	"collection_integrations",
];

// Tables auth flows must read before the tenant is known. Not RLS-scoped;
// vcts_app should not be allowed to touch them - we only use neondb_owner for
// these lookups. So we intentionally do NOT grant vcts_app any rights on them.
const AUTH_ONLY_TABLES = ["users", "tenants", "refresh_tokens"];

async function exec(stmt: string, params: unknown[] = []): Promise<void> {
	await sql.query(stmt, params);
}

async function ensureAppRole(): Promise<void> {
	const exists = await sql.query(
		`SELECT 1 AS x FROM pg_roles WHERE rolname = 'vcts_app'`,
	);
	if (exists.length === 0) {
		// CREATE ROLE doesn't accept parameters for password - inline as literal.
		// appPassword is [a-zA-Z0-9]+ per gen-keys.ts, safe for inline quoting.
		await exec(
			`CREATE ROLE vcts_app WITH LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOSUPERUSER PASSWORD '${appPassword}'`,
		);
		console.log("  [ok] created role vcts_app");
	} else {
		// Only touch things the (non-super) owner is allowed to change. LOGIN
		// + password are fine; SUPERUSER/NOSUPERUSER requires actual superuser.
		await exec(
			`ALTER ROLE vcts_app WITH LOGIN NOBYPASSRLS PASSWORD '${appPassword}'`,
		);
		console.log("  [ok] refreshed role vcts_app (password synced)");
	}
}

async function grantAppPrivileges(): Promise<void> {
	await exec(`GRANT CONNECT ON DATABASE neondb TO vcts_app`);
	await exec(`GRANT USAGE ON SCHEMA public TO vcts_app`);

	// Per-table privileges: vcts_app gets SELECT/INSERT/UPDATE on tenant tables,
	// but NO DELETE on the financial ledger or the audit trail (append-only).
	for (const t of TENANT_TABLES) {
		// Append-only ledger tables: vcts_app may write but never DELETE rows.
		// supervisor_reviews can be UPDATEd (to set resolved_at/resolved_by)
		// but rows must never disappear. location_logs are pure facts and
		// never edited - INSERT only is enough.
		const grants =
			t === "collections" ||
			t === "audit_trail" ||
			t === "supervisor_reviews" ||
			t === "customer_visits"
				? "SELECT, INSERT, UPDATE"
				: t === "location_logs"
					? "SELECT, INSERT"
					: "SELECT, INSERT, UPDATE, DELETE";
		await exec(`GRANT ${grants} ON TABLE "${t}" TO vcts_app`);
	}

	// Sequences / identity columns used by those tables (for DEFAULT gen_random_uuid none; but include anyway)
	await exec(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vcts_app`);

	// Make future tables auto-inherit the app's read/write policy by default so
	// we don't forget after running a new `db:push`.
	await exec(
		`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO vcts_app`,
	);
	await exec(
		`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vcts_app`,
	);

	// Explicitly deny all privileges on auth-only tables (default is no grant,
	// but belt-and-braces in case some future grant sweeps too broadly).
	for (const t of AUTH_ONLY_TABLES) {
		await exec(`REVOKE ALL ON TABLE "${t}" FROM vcts_app`);
	}

	console.log("  [ok] privileges granted to vcts_app");
}

async function applyRls(): Promise<void> {
	for (const table of TENANT_TABLES) {
		await exec(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
		await exec(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
		await exec(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
		// `nullif(..., '')` coerces "setting absent" and "setting empty" to NULL,
		// and `tenant_id = NULL` is NULL (not true), so with no tenant context
		// we see zero rows and never hit a "invalid input syntax for uuid" cast
		// error. In production that's a last-resort safety net; the app should
		// never forget to call withTenant().
		await exec(
			`CREATE POLICY tenant_isolation ON "${table}" ` +
				`USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) ` +
				`WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`,
		);
		console.log(`  [ok] RLS on ${table}`);
	}
}

async function applyReceiptSequence(): Promise<void> {
	// Atomic "give me the next receipt sequence" function. Runs as the table
	// owner (neondb_owner) and uses INSERT ... ON CONFLICT DO UPDATE to read +
	// increment in a single statement. SECURITY DEFINER lets vcts_app call it
	// even though it has no rights on the underlying counter rows for tenants
	// other than its own; the SET app.tenant_id check inside guarantees we
	// never bump another tenant's counter.
	await exec(`
		CREATE OR REPLACE FUNCTION next_receipt_seq(
			p_tenant_id uuid,
			p_agent_id uuid,
			p_fiscal_year integer
		) RETURNS integer
		LANGUAGE plpgsql
		SECURITY DEFINER
		SET search_path = public
		AS $$
		DECLARE
			v_setting text := nullif(current_setting('app.tenant_id', true), '');
			v_seq integer;
		BEGIN
			-- If the caller has a tenant context (i.e. came in via vcts_app),
			-- enforce it; auth-only paths (neondb_owner) won't have one set
			-- and are allowed through (used by seeds).
			IF v_setting IS NOT NULL AND v_setting::uuid <> p_tenant_id THEN
				RAISE EXCEPTION 'tenant mismatch: app.tenant_id=% != p_tenant_id=%',
					v_setting, p_tenant_id
					USING ERRCODE = 'insufficient_privilege';
			END IF;

			INSERT INTO receipt_counters (tenant_id, agent_id, fiscal_year, next_seq)
			VALUES (p_tenant_id, p_agent_id, p_fiscal_year, 2)
			ON CONFLICT (tenant_id, agent_id, fiscal_year) DO UPDATE
				SET next_seq = receipt_counters.next_seq + 1
			RETURNING next_seq - 1 INTO v_seq;

			RETURN v_seq;
		END;
		$$;
	`);

	await exec(
		`GRANT EXECUTE ON FUNCTION next_receipt_seq(uuid, uuid, integer) TO vcts_app`,
	);
	console.log("  [ok] function next_receipt_seq()");
}

async function dumpState(label: string): Promise<void> {
	console.log(`\n=== ${label} ===`);
	const role = (await sql.query(
		`SELECT rolname, rolbypassrls, rolcanlogin
		 FROM pg_roles WHERE rolname = 'vcts_app'`,
	)) as Array<{ rolname: string; rolbypassrls: boolean; rolcanlogin: boolean }>;
	if (role.length === 0) {
		console.log("  vcts_app role: MISSING");
	} else {
		const r = role[0];
		console.log(
			`  vcts_app role: bypassrls=${r.rolbypassrls} canlogin=${r.rolcanlogin}`,
		);
	}
	for (const t of TENANT_TABLES) {
		const cls = (await sql.query(
			`SELECT relrowsecurity AS rls, relforcerowsecurity AS forced
			 FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
			[t],
		)) as Array<{ rls: boolean; forced: boolean }>;
		const pol = (await sql.query(
			`SELECT count(*)::int AS n FROM pg_policies
			 WHERE schemaname = 'public' AND tablename = $1`,
			[t],
		)) as Array<{ n: number }>;
		const c = cls[0];
		console.log(
			`  ${t.padEnd(22)} rls=${c?.rls ?? "?"} forced=${c?.forced ?? "?"} policies=${pol[0]?.n ?? "?"}`,
		);
	}
}

async function main() {
	await dumpState("RLS state BEFORE");

	console.log("\nProvisioning vcts_app role...");
	await ensureAppRole();
	await grantAppPrivileges();

	console.log("\nApplying RLS policies...");
	await applyRls();

	console.log("\nApplying helper SQL functions...");
	await applyReceiptSequence();

	await dumpState("RLS state AFTER");

	console.log("\nDone. Runtime connections should use APP_DATABASE_URL");
	console.log("(constructed automatically by src/db/client.ts from DATABASE_URL + APP_DB_PASSWORD).");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
