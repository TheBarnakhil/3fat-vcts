/**
 * Seeds two demo tenants so the Phase 1 tenant-isolation tests have data to
 * work with. Safe to re-run: it wipes existing demo data (by slug) first,
 * then recreates. DO NOT run against a production database.
 *
 *   pnpm db:seed
 */
import { inArray } from "drizzle-orm";
import { pool } from "@/db/client";
import {
	auditTrail,
	customers,
	refreshTokens,
	tenants,
	users,
} from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { hashPassword } from "@/lib/auth/password";

type SeedTenant = {
	slug: string;
	name: string;
	accentHsl: string;
	legalName: string;
	admin: { email: string; name: string; password: string };
	manager?: { email: string; name: string; password: string };
	agents: Array<{ email: string; name: string; agentCode: string; password: string }>;
	customers: Array<{
		code: string;
		name: string;
		address: string;
		phone: string;
		lat: number;
		lng: number;
		radius?: number;
		outstanding: number;
	}>;
};

const DEMO: SeedTenant[] = [
	{
		slug: "acme",
		name: "Acme Distributors",
		accentHsl: "221 83% 53%", // indigo-ish
		legalName: "Acme Distributors Pvt. Ltd.",
		admin: { email: "admin@acme.test", name: "Ava Acme", password: "Passw0rd!" },
		manager: { email: "manager@acme.test", name: "Mia Manager", password: "Passw0rd!" },
		agents: [
			{ email: "agent1@acme.test", name: "Arjun Agent", agentCode: "A001", password: "Passw0rd!" },
			{ email: "agent2@acme.test", name: "Anita Agent", agentCode: "A002", password: "Passw0rd!" },
		],
		customers: [
			{ code: "C001", name: "Koramangala Kirana", address: "80 Ft Rd, Koramangala, Bengaluru", phone: "+91-9900011111", lat: 12.9352, lng: 77.6245, outstanding: 12500 },
			{ code: "C002", name: "Indiranagar Provisions", address: "100 Ft Rd, Indiranagar, Bengaluru", phone: "+91-9900022222", lat: 12.9719, lng: 77.6412, outstanding: 8450 },
			{ code: "C003", name: "HSR Supermart", address: "27th Main, HSR Layout, Bengaluru", phone: "+91-9900033333", lat: 12.9121, lng: 77.6446, outstanding: 21300 },
			{ code: "C004", name: "Jayanagar Stores", address: "11th Main, Jayanagar, Bengaluru", phone: "+91-9900044444", lat: 12.9250, lng: 77.5938, outstanding: 0 },
			{ code: "C005", name: "Whitefield Wholesale", address: "ITPL Main Rd, Whitefield, Bengaluru", phone: "+91-9900055555", lat: 12.9698, lng: 77.7500, outstanding: 45000 },
		],
	},
	{
		slug: "globex",
		name: "Globex Trading",
		accentHsl: "142 76% 36%", // green
		legalName: "Globex Trading Co. Ltd.",
		admin: { email: "admin@globex.test", name: "Gina Globex", password: "Passw0rd!" },
		agents: [
			{ email: "agent1@globex.test", name: "Gautam Agent", agentCode: "G001", password: "Passw0rd!" },
		],
		customers: [
			{ code: "G-C001", name: "Andheri Mart", address: "Link Rd, Andheri W, Mumbai", phone: "+91-9988811111", lat: 19.1197, lng: 72.8464, outstanding: 33000 },
			{ code: "G-C002", name: "Bandra Bazaar", address: "Linking Rd, Bandra W, Mumbai", phone: "+91-9988822222", lat: 19.0596, lng: 72.8295, outstanding: 15750 },
			{ code: "G-C003", name: "Powai Supplies", address: "Hiranandani, Powai, Mumbai", phone: "+91-9988833333", lat: 19.1176, lng: 72.9060, outstanding: 9200 },
		],
	},
];

async function nukeDemoTenants(slugs: string[]): Promise<void> {
	// withoutTenant: we need to touch multiple tenants + auth tables. We remove
	// child rows before tenant rows because FKs are ON DELETE RESTRICT.
	await withoutTenant(async (tx) => {
		const existing = await tx
			.select({ id: tenants.id })
			.from(tenants)
			.where(inArray(tenants.slug, slugs));
		const ids = existing.map((r) => r.id);
		if (ids.length === 0) return;

		await tx.delete(auditTrail).where(inArray(auditTrail.tenantId, ids));
		await tx.delete(refreshTokens).where(inArray(refreshTokens.tenantId, ids));
		await tx.delete(customers).where(inArray(customers.tenantId, ids));
		await tx.delete(users).where(inArray(users.tenantId, ids));
		await tx.delete(tenants).where(inArray(tenants.id, ids));
	});
}

async function seedTenant(t: SeedTenant): Promise<void> {
	// Create tenant row (no RLS on tenants table)
	const [tenantRow] = await withoutTenant(async (tx) =>
		tx
			.insert(tenants)
			.values({
				slug: t.slug,
				name: t.name,
				settings: {
					branding: { legalName: t.legalName, accentHsl: t.accentHsl },
					geofence: { defaultRadiusM: 100, minAccuracyM: 50 },
					sync: { intervalMin: 15 },
				},
			})
			.returning(),
	);

	// Hash all passwords first (cpu-heavy, do it outside the tx)
	const adminHash = await hashPassword(t.admin.password);
	const managerHash = t.manager ? await hashPassword(t.manager.password) : null;
	const agentHashes = await Promise.all(t.agents.map((a) => hashPassword(a.password)));

	// The seed is intentionally cross-tenant, so it runs as the owner role
	// (BYPASSRLS). Inserts carry an explicit tenant_id and appendAudit filters
	// by tenant_id, so each tenant's data stays in its own lane.
	await withoutTenant(async (tx) => {
		const [admin] = await tx
			.insert(users)
			.values({
				tenantId: tenantRow.id,
				email: t.admin.email,
				passwordHash: adminHash,
				name: t.admin.name,
				role: "super_admin",
			})
			.returning({ id: users.id });

		if (t.manager && managerHash) {
			await tx.insert(users).values({
				tenantId: tenantRow.id,
				email: t.manager.email,
				passwordHash: managerHash,
				name: t.manager.name,
				role: "manager",
			});
		}

		const agentRows = await tx
			.insert(users)
			.values(
				t.agents.map((a, i) => ({
					tenantId: tenantRow.id,
					email: a.email,
					passwordHash: agentHashes[i],
					name: a.name,
					agentCode: a.agentCode,
					role: "agent" as const,
				})),
			)
			.returning({ id: users.id });

		// Round-robin assign customers to agents
		await tx.insert(customers).values(
			t.customers.map((c, i) => ({
				tenantId: tenantRow.id,
				code: c.code,
				name: c.name,
				address: c.address,
				phone: c.phone,
				lat: c.lat,
				lng: c.lng,
				geofenceRadiusM: c.radius ?? 100,
				outstandingBalance: c.outstanding,
				assignedAgentId: agentRows[i % agentRows.length]?.id ?? null,
			})),
		);

		await appendAudit(tx, {
			tenantId: tenantRow.id,
			actorId: admin.id,
			action: "tenant.seeded",
			entityType: "tenant",
			entityId: tenantRow.id,
			after: { slug: t.slug, name: t.name },
		});
	});

	console.log(`  [ok] ${t.slug} - 1 super_admin, ${t.manager ? 1 : 0} manager, ${t.agents.length} agents, ${t.customers.length} customers`);
}

async function main() {
	const slugs = DEMO.map((t) => t.slug);
	console.log("Wiping any existing demo data for", slugs.join(", "));
	await nukeDemoTenants(slugs);

	console.log("Seeding tenants...");
	for (const t of DEMO) {
		await seedTenant(t);
	}

	console.log("\nDone. Login test credentials:");
	for (const t of DEMO) {
		console.log(`  ${t.slug.padEnd(8)} super_admin  ${t.admin.email}  / ${t.admin.password}`);
		if (t.manager) console.log(`  ${t.slug.padEnd(8)} manager      ${t.manager.email}  / ${t.manager.password}`);
		for (const a of t.agents) {
			console.log(`  ${t.slug.padEnd(8)} agent (${a.agentCode})  ${a.email} / ${a.password}`);
		}
	}
}

main()
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
	.finally(async () => {
		await pool.end();
	});
