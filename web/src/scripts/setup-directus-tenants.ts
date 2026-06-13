/**
 * Provisions Directus tenant isolation for demo/app tenants:
 *   policy + permissions + role + service user + static token + test collection
 *
 *   pnpm setup:directus
 *
 * Prints a DIRECTUS_TENANT_TOKENS JSON blob to paste into .env.local / Vercel.
 */
import { randomBytes } from "node:crypto";

import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { tenants } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import {
	directusFetch,
	prefixedCollection,
	requireAdminToken,
	requireDirectusUrl,
} from "@/lib/cms/directus";

const TEST_COLLECTION = "collection_responses";
const ACTIONS = ["read", "create", "update", "delete"] as const;

type DirectusList<T> = { data: T[] };
type DirectusOne<T> = { data: T };

async function listUsers(email: string) {
	const q = encodeURIComponent(JSON.stringify({ email: { _eq: email } }));
	const res = await directusFetch<DirectusList<{ id: string; token?: string }>>(
		`/users?filter=${q}&fields=id,email,token`,
		{ token: requireAdminToken() },
	);
	return res.data;
}

async function ensureTestCollection(slug: string): Promise<string> {
	const collection = prefixedCollection(slug, TEST_COLLECTION);
	const admin = requireAdminToken();
	try {
		const meta = await directusFetch<DirectusOne<{ schema?: unknown }>>(
			`/collections/${collection}`,
			{ token: admin },
		);
		if (meta.data.schema) {
			console.log(`  [ok] collection ${collection} exists`);
			return collection;
		}
		console.log(`  [warn] ${collection} missing DB schema; recreating`);
		await directusFetch(`/collections/${collection}`, { method: "DELETE", token: admin });
	} catch {
		// fall through to create
	}
	await directusFetch<DirectusOne<{ collection: string }>>("/collections", {
		method: "POST",
		token: admin,
		body: JSON.stringify({
			collection,
			meta: {
				icon: "inventory_2",
				note: `VCTS tenant collection for ${slug}`,
			},
			schema: {},
			fields: [
				{
					field: "id",
					type: "integer",
					schema: { is_primary_key: true, has_auto_increment: true },
					meta: { hidden: true, interface: "input", readonly: true },
				},
				{ field: "sku", type: "string", meta: { interface: "input", required: true } },
				{ field: "name", type: "string", meta: { interface: "input" } },
				{
					field: "available_qty",
					type: "integer",
					meta: { interface: "input" },
				},
				{ field: "unit", type: "string", meta: { interface: "input" } },
				{
					field: "price",
					type: "decimal",
					schema: { numeric_precision: 10, numeric_scale: 2 },
					meta: { interface: "input" },
				},
			],
		}),
	});
	console.log(`  [ok] created collection ${collection}`);
	return collection;
}

async function ensureTenantDirectus(slug: string): Promise<string> {
	const admin = requireAdminToken();
	const collection = await ensureTestCollection(slug);
	const email = `vcts-${slug}@example.com`;
	const existing = await listUsers(email);
	if (existing.length > 0) {
		const token = `vcts_${slug}_${randomBytes(24).toString("hex")}`;
		await directusFetch(`/users/${existing[0].id}`, {
			method: "PATCH",
			token: admin,
			body: JSON.stringify({ token }),
		});
		console.log(`  [ok] ${slug}: rotated token on existing service user (${email})`);
		return token;
	}

	const policyName = `VCTS Tenant ${slug}`;
	const roleName = `VCTS Role ${slug}`;

	const policy = await directusFetch<DirectusOne<{ id: string }>>("/policies", {
		method: "POST",
		token: admin,
		body: JSON.stringify({
			name: policyName,
			admin_access: false,
			app_access: false,
		}),
	});

	for (const action of ACTIONS) {
		await directusFetch("/permissions", {
			method: "POST",
			token: admin,
			body: JSON.stringify({
				policy: policy.data.id,
				collection,
				action,
				fields: ["*"],
			}),
		});
	}

	const role = await directusFetch<DirectusOne<{ id: string }>>("/roles", {
		method: "POST",
		token: admin,
		body: JSON.stringify({ name: roleName }),
	});

	await directusFetch("/access", {
		method: "POST",
		token: admin,
		body: JSON.stringify({ role: role.data.id, policy: policy.data.id }),
	});

	const token = `vcts_${slug}_${randomBytes(24).toString("hex")}`;
	await directusFetch("/users", {
		method: "POST",
		token: admin,
		body: JSON.stringify({
			first_name: "VCTS",
			last_name: slug,
			email,
			role: role.data.id,
			token,
			status: "active",
		}),
	});

	console.log(`  [ok] ${slug}: created service user + token`);
	return token;
}

async function main() {
	console.log("Directus URL:", requireDirectusUrl());
	const health = await directusFetch<{ status?: string }>("/server/health");
	console.log("Health:", health.status ?? health);

	const tenantRows = await withoutTenant(async (tx) =>
		tx.select({ slug: tenants.slug, name: tenants.name }).from(tenants).orderBy(tenants.slug),
	);
	if (tenantRows.length === 0) {
		console.error("\nNo tenants in app DB. Run `pnpm db:seed` first.");
		process.exit(1);
	}

	console.log(`\nProvisioning ${tenantRows.length} tenant(s)...`);
	const tokenMap: Record<string, string> = {};
	for (const t of tenantRows) {
		console.log(`\n→ ${t.slug} (${t.name})`);
		tokenMap[t.slug] = await ensureTenantDirectus(t.slug);
	}

	console.log("\nPaste into .env.local / Vercel:\n");
	console.log(`DIRECTUS_TENANT_TOKENS='${JSON.stringify(tokenMap)}'`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
