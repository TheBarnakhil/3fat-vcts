/**
 * Verifies Directus connectivity + tenant token isolation.
 *
 *   pnpm verify:directus
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { tenants } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import {
	directusFetch,
	parseTenantTokens,
	prefixedCollection,
	requireAdminToken,
	requireDirectusUrl,
} from "@/lib/cms/directus";
import { env } from "@/lib/env";

const TEST_COLLECTION = "collection_responses";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
	if (cond) {
		console.log(`  [ok] ${name}`);
		passed++;
	} else {
		console.log(`  [FAIL] ${name}${detail ? ` - ${detail}` : ""}`);
		failed++;
	}
}

async function main() {
	console.log("0. Env");
	check("DIRECTUS_URL set", Boolean(env.DIRECTUS_URL));
	check("DIRECTUS_ADMIN_TOKEN set", Boolean(env.DIRECTUS_ADMIN_TOKEN));
	const tokenMap = parseTenantTokens(env.DIRECTUS_TENANT_TOKENS);
	check(
		"DIRECTUS_TENANT_TOKENS has entries",
		Object.keys(tokenMap).length > 0,
		"run pnpm setup:directus and paste output",
	);

	console.log("\n1. Directus health + admin");
	requireDirectusUrl();
	const health = await directusFetch<{ status?: string }>("/server/health");
	check("health ok", health.status === "ok", String(health.status));
	const me = await directusFetch<{ data?: { email?: string; role?: { name?: string } } }>(
		"/users/me?fields=email,role.name",
		{ token: requireAdminToken() },
	);
	check("admin token valid", Boolean(me.data?.email), me.data?.email);

	console.log("\n2. App DB tenants");
	const tenantRows = await withoutTenant(async (tx) =>
		tx.select({ slug: tenants.slug }).from(tenants).orderBy(tenants.slug),
	);
	check("at least one tenant", tenantRows.length > 0);
	for (const t of tenantRows) {
		check(`token configured for ${t.slug}`, Boolean(tokenMap[t.slug]));
	}

	console.log("\n3. Tenant token CRUD + isolation");
	for (const t of tenantRows) {
		const token = tokenMap[t.slug];
		if (!token) continue;
		const collection = prefixedCollection(t.slug, TEST_COLLECTION);
		const list = await directusFetch<{ data?: unknown[] }>(
			`/items/${collection}?limit=1`,
			{ token },
		);
		check(`${t.slug} can read own collection`, Array.isArray(list.data));

		const marker = `verify-${Date.now()}`;
		const created = await directusFetch<{ data?: { id?: number } }>(
			`/items/${collection}`,
			{
				method: "POST",
				token,
				body: JSON.stringify({
					sku: marker,
					name: "verify item",
					available_qty: 1,
				}),
			},
		);
		check(`${t.slug} can create item`, typeof created.data?.id === "number");
	}

	const slugs = tenantRows.map((t) => t.slug);
	if (slugs.length >= 2) {
		const a = slugs[0];
		const b = slugs[1];
		const foreign = prefixedCollection(b, TEST_COLLECTION);
		try {
			await directusFetch(`/items/${foreign}?limit=1`, { token: tokenMap[a] });
			check(`${a} blocked from ${b} collection`, false);
		} catch {
			check(`${a} blocked from ${b} collection`, true);
		}
	}

	console.log(`\nDone: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
