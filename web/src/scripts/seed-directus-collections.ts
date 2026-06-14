/**
 * Creates demo Directus collections + sample rows for each app tenant.
 * Idempotent: skips collections that already exist; seeds only when empty.
 *
 *   pnpm seed:directus
 *
 * Requires: pnpm setup:directus (tenant policies + DIRECTUS_TENANT_TOKENS)
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
	tenantDirectusToken,
} from "@/lib/cms/directus";
import { env } from "@/lib/env";

const ACTIONS = ["read", "create", "update", "delete"] as const;

type DirectusList<T> = { data: T[] };
type DirectusOne<T> = { data: T };

type FieldSpec = {
	field: string;
	type: string;
	schema?: Record<string, unknown>;
	meta?: Record<string, unknown>;
};

type DemoCollection = {
	name: string;
	icon: string;
	note: string;
	fields: FieldSpec[];
	seedRows: (slug: string) => Record<string, unknown>[];
};

const ID_FIELD: FieldSpec = {
	field: "id",
	type: "integer",
	schema: { is_primary_key: true, has_auto_increment: true },
	meta: { hidden: true, interface: "input", readonly: true },
};

const DEMO_COLLECTIONS: DemoCollection[] = [
	{
		name: "collection_responses",
		icon: "dynamic_form",
		note: "Field-agent responses synced from the VCTS offline integration",
		fields: [
			{ field: "sku", type: "string", meta: { interface: "input", required: true } },
			{ field: "name", type: "string", meta: { interface: "input" } },
			{
				field: "available_qty",
				type: "integer",
				meta: { interface: "input" },
			},
			{
				field: "unit",
				type: "string",
				meta: {
					interface: "select-dropdown",
					options: {
						choices: [
							{ text: "pcs", value: "pcs" },
							{ text: "kg", value: "kg" },
							{ text: "ltr", value: "ltr" },
							{ text: "box", value: "box" },
						],
					},
				},
			},
			{
				field: "price",
				type: "decimal",
				schema: { numeric_precision: 10, numeric_scale: 2 },
				meta: { interface: "input" },
			},
		],
		seedRows: (slug) => [
			{
				sku: `${slug.toUpperCase()}-SKU-001`,
				name: `${slug} sample product A`,
				available_qty: 24,
				unit: "pcs",
				price: 149.5,
			},
			{
				sku: `${slug.toUpperCase()}-SKU-002`,
				name: `${slug} sample product B`,
				available_qty: 8,
				unit: "box",
				price: 899,
			},
		],
	},
	{
		name: "products",
		icon: "inventory_2",
		note: "Reference product catalog for agents (WebView / admin demos)",
		fields: [
			{ field: "sku", type: "string", meta: { interface: "input", required: true } },
			{ field: "name", type: "string", meta: { interface: "input", required: true } },
			{
				field: "category",
				type: "string",
				meta: {
					interface: "select-dropdown",
					options: {
						choices: [
							{ text: "FMCG", value: "fmcg" },
							{ text: "Hardware", value: "hardware" },
							{ text: "Services", value: "services" },
						],
					},
				},
			},
			{
				field: "unit_price",
				type: "decimal",
				schema: { numeric_precision: 10, numeric_scale: 2 },
				meta: { interface: "input" },
			},
			{
				field: "in_stock",
				type: "boolean",
				meta: { interface: "boolean" },
			},
		],
		seedRows: (slug) => [
			{
				sku: `${slug}-PROD-100`,
				name: `${slug} premium widget`,
				category: "hardware",
				unit_price: 499.99,
				in_stock: true,
			},
			{
				sku: `${slug}-PROD-200`,
				name: `${slug} economy pack`,
				category: "fmcg",
				unit_price: 79,
				in_stock: true,
			},
			{
				sku: `${slug}-PROD-300`,
				name: `${slug} service visit`,
				category: "services",
				unit_price: 250,
				in_stock: false,
			},
		],
	},
	{
		name: "customer_notes",
		icon: "sticky_note_2",
		note: "Free-form customer visit notes captured in Directus",
		fields: [
			{
				field: "customer_code",
				type: "string",
				meta: { interface: "input", required: true },
			},
			{ field: "subject", type: "string", meta: { interface: "input" } },
			{
				field: "body",
				type: "text",
				meta: { interface: "input-multiline" },
			},
			{
				field: "follow_up",
				type: "boolean",
				meta: { interface: "boolean" },
			},
		],
		seedRows: (slug) => [
			{
				customer_code: `${slug.toUpperCase()}-C001`,
				subject: "Payment plan agreed",
				body: "Customer will clear 50% this week and balance next Friday.",
				follow_up: true,
			},
			{
				customer_code: `${slug.toUpperCase()}-C002`,
				subject: "Stock check",
				body: "Shelf display needs restock; send merchandising team.",
				follow_up: false,
			},
		],
	},
];

async function findPolicyId(slug: string): Promise<string | null> {
	const admin = requireAdminToken();
	const filter = encodeURIComponent(JSON.stringify({ name: { _eq: `VCTS Tenant ${slug}` } }));
	const res = await directusFetch<DirectusList<{ id: string }>>(
		`/policies?filter=${filter}&limit=1`,
		{ token: admin },
	);
	return res.data[0]?.id ?? null;
}

async function ensurePermissions(slug: string, collection: string): Promise<void> {
	const policyId = await findPolicyId(slug);
	if (!policyId) {
		console.log(`  [warn] no policy for ${slug}; run pnpm setup:directus first`);
		return;
	}
	const admin = requireAdminToken();
	const filter = encodeURIComponent(
		JSON.stringify({ policy: { _eq: policyId }, collection: { _eq: collection } }),
	);
	const existing = await directusFetch<DirectusList<{ action: string }>>(
		`/permissions?filter=${filter}`,
		{ token: admin },
	);
	const have = new Set(existing.data.map((p) => p.action));
	for (const action of ACTIONS) {
		if (have.has(action)) continue;
		await directusFetch("/permissions", {
			method: "POST",
			token: admin,
			body: JSON.stringify({
				policy: policyId,
				collection,
				action,
				fields: ["*"],
			}),
		});
	}
}

async function ensureCollection(slug: string, demo: DemoCollection): Promise<string> {
	const collection = prefixedCollection(slug, demo.name);
	const admin = requireAdminToken();
	try {
		const meta = await directusFetch<DirectusOne<{ schema?: unknown }>>(
			`/collections/${collection}`,
			{ token: admin },
		);
		if (meta.data.schema) {
			console.log(`  [ok] ${collection} exists`);
			await ensurePermissions(slug, collection);
			return collection;
		}
		console.log(`  [warn] ${collection} missing DB schema; recreating`);
		await directusFetch(`/collections/${collection}`, { method: "DELETE", token: admin });
	} catch {
		// create below
	}

	await directusFetch("/collections", {
		method: "POST",
		token: admin,
		body: JSON.stringify({
			collection,
			meta: { icon: demo.icon, note: `${demo.note} (${slug})` },
			schema: {},
			fields: [ID_FIELD, ...demo.fields],
		}),
	});
	console.log(`  [ok] created ${collection}`);
	await ensurePermissions(slug, collection);
	return collection;
}

async function seedIfEmpty(
	slug: string,
	collection: string,
	rows: Record<string, unknown>[],
): Promise<void> {
	const token = tenantDirectusToken(slug);
	const existing = await directusFetch<{ data?: unknown[] }>(
		`/items/${collection}?limit=1&fields=id`,
		{ token },
	);
	if ((existing.data?.length ?? 0) > 0) {
		console.log(`  [skip] ${collection} already has data`);
		return;
	}
	for (const row of rows) {
		await directusFetch(`/items/${collection}`, {
			method: "POST",
			token,
			body: JSON.stringify(row),
		});
	}
	console.log(`  [ok] seeded ${rows.length} row(s) in ${collection}`);
}

async function main() {
	console.log("Directus URL:", requireDirectusUrl());
	parseTenantTokens(env.DIRECTUS_TENANT_TOKENS);

	const tenantRows = await withoutTenant(async (tx) =>
		tx.select({ slug: tenants.slug, name: tenants.name }).from(tenants).orderBy(tenants.slug),
	);
	if (tenantRows.length === 0) {
		console.error("No tenants in app DB. Run pnpm db:seed first.");
		process.exit(1);
	}

	for (const tenant of tenantRows) {
		console.log(`\n→ ${tenant.slug} (${tenant.name})`);
		for (const demo of DEMO_COLLECTIONS) {
			const collection = await ensureCollection(tenant.slug, demo);
			await seedIfEmpty(tenant.slug, collection, demo.seedRows(tenant.slug));
		}
	}

	console.log("\nDone. Run pnpm verify:directus to confirm tenant access.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
