import { sql } from "drizzle-orm";
import { adminDb, db } from "./client";

/** The exact transaction type drizzle hands our callback - inferred once here. */
export type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` inside a transaction AS the `vcts_app` role with `app.tenant_id`
 * set to the given tenant. RLS policies on every domain table check
 * `current_setting('app.tenant_id')`, so queries are automatically filtered
 * by Postgres itself - app-code bugs cannot leak data across tenants.
 *
 * An empty / missing setting resolves to NULL and `tenant_id = NULL` is NULL,
 * so rows are invisible by default - safe if anything forgets to call this.
 */
export async function withTenant<T>(
	tenantId: string,
	fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
	return db.transaction(async (tx) => {
		// `set_config(setting, value, is_local=true)` scopes the variable to this
		// transaction. Passing tenantId as a parameter prevents SQL injection
		// even though our auth layer already guarantees it's a uuid.
		await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
		return fn(tx);
	});
}

/**
 * Runs `fn` AS `neondb_owner`, which has BYPASSRLS and therefore sees all
 * tenants. Use sparingly, only for:
 *   - login / refresh (need email -> tenant lookup)
 *   - seeds and platform-admin tooling
 *
 * Never call this from a route handler that is reachable by regular users.
 */
export async function withoutTenant<T>(
	fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
	return adminDb.transaction(async (tx) => fn(tx));
}
