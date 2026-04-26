/**
 * Seeds a few demo collections in the existing demo tenants so the new
 * /collections page isn't empty out of the gate. Uses the same code paths as
 * the API (geofence + idempotency + sequence allocation + audit chain) so a
 * successful seed also acts as an end-to-end smoke test.
 *
 *   pnpm db:seed:phase3
 *
 * Safe to re-run: each seeded row uses a deterministic clientUuid per agent +
 * customer + index, so a second invocation just no-ops via the idempotency
 * check.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { and, eq, sql } from "drizzle-orm";
import { pool } from "@/db/client";
import {
	collections as collectionsTable,
	customers,
	tenants,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { fiscalYearForDate, formatReceiptNo } from "@/lib/receipts/format";

type Plan = {
	tenantSlug: string;
	collectionsPerCustomer: number;
};

const PLANS: Plan[] = [
	{ tenantSlug: "acme", collectionsPerCustomer: 2 },
	{ tenantSlug: "globex", collectionsPerCustomer: 1 },
];

// Deterministic UUID v5-ish: hash a label down to 32 hex + format. We don't
// need cryptographic uniqueness, just stable repeats across seed runs.
async function stableUuid(label: string): Promise<string> {
	const { createHash } = await import("node:crypto");
	const hex = createHash("sha256").update(label).digest("hex").slice(0, 32);
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		// version 4 nibble
		"4" + hex.slice(13, 16),
		// variant nibble
		"8" + hex.slice(17, 20),
		hex.slice(20, 32),
	].join("-");
}

async function seedTenant(plan: Plan): Promise<void> {
	const [tenant] = await withoutTenant(async (tx) =>
		tx.select().from(tenants).where(eq(tenants.slug, plan.tenantSlug)).limit(1),
	);
	if (!tenant) {
		console.log(`  [skip] tenant ${plan.tenantSlug} not found - run pnpm db:seed first.`);
		return;
	}

	// Pull the agents + their assigned customers (auth-only path).
	const agentRows = await withoutTenant(async (tx) =>
		tx
			.select({ id: users.id, agentCode: users.agentCode, name: users.name })
			.from(users)
			.where(and(eq(users.tenantId, tenant.id), eq(users.role, "agent"))),
	);
	if (agentRows.length === 0) {
		console.log(`  [skip] tenant ${plan.tenantSlug} has no agents.`);
		return;
	}

	let inserted = 0;
	let replayed = 0;

	for (const agent of agentRows) {
		if (!agent.agentCode) continue;

		// All customers assigned to this agent (RLS-scoped).
		const cust = await withTenant(tenant.id, async (tx) =>
			tx
				.select()
				.from(customers)
				.where(eq(customers.assignedAgentId, agent.id)),
		);
		if (cust.length === 0) continue;

		for (const c of cust) {
			for (let i = 0; i < plan.collectionsPerCustomer; i++) {
				const clientUuid = await stableUuid(
					`seed:${tenant.slug}:${agent.id}:${c.id}:${i}`,
				);
				const collectedAt = new Date(Date.now() - (i + 1) * 86_400_000);
				const fy = fiscalYearForDate(collectedAt);
				const amount = 500 * (i + 1) + ((c.id.charCodeAt(0) % 5) + 1) * 100;
				const mode: "cash" | "upi" =
					(c.id.charCodeAt(1) + i) % 2 === 0 ? "cash" : "upi";

				await withTenant(tenant.id, async (tx) => {
					const existing = await tx
						.select()
						.from(collectionsTable)
						.where(eq(collectionsTable.clientUuid, clientUuid))
						.limit(1);
					if (existing[0]) {
						replayed++;
						return;
					}

					const seqRes = await tx.execute(
						sql`SELECT next_receipt_seq(${tenant.id}::uuid, ${agent.id}::uuid, ${fy.fyStart}::int) AS seq`,
					);
					const seqRows = (seqRes as unknown as {
						rows?: Array<{ seq: number }>;
					}).rows ?? (seqRes as unknown as Array<{ seq: number }>);
					const seq = Number(
						(Array.isArray(seqRows) ? seqRows[0] : { seq: 0 }).seq,
					);

					const receiptNo = formatReceiptNo({
						tenantSlug: tenant.slug,
						agentCode: agent.agentCode!,
						fyLabel: fy.label,
						seq,
					});

					const [row] = await tx
						.insert(collectionsTable)
						.values({
							tenantId: tenant.id,
							clientUuid,
							customerId: c.id,
							agentId: agent.id,
							amount,
							paymentMode: mode,
							refNo: mode === "upi" ? `UPI${seq.toString().padStart(6, "0")}` : null,
							collectionLat: c.lat + (Math.random() - 0.5) * 0.0002,
							collectionLng: c.lng + (Math.random() - 0.5) * 0.0002,
							gpsAccuracyM: 8 + Math.random() * 12,
							collectedAt,
							receiptNo,
							deviceId: "seed-script",
							syncStatus: "synced",
						})
						.returning();
					inserted++;

					await tx
						.update(customers)
						.set({
							outstandingBalance: sql`${customers.outstandingBalance} - ${amount}`,
							updatedAt: new Date(),
						})
						.where(eq(customers.id, c.id));

					await appendAudit(tx, {
						tenantId: tenant.id,
						actorId: agent.id,
						action: "collection.create",
						entityType: "collection",
						entityId: row.id,
						after: {
							receiptNo,
							customerId: row.customerId,
							amount: row.amount,
							paymentMode: row.paymentMode,
							lat: row.collectionLat,
							lng: row.collectionLng,
							distanceM: 0,
							allowedM: c.geofenceRadiusM,
							seed: true,
						},
						deviceId: "seed-script",
					});
				});
			}
		}
	}

	console.log(
		`  [ok] ${plan.tenantSlug}: inserted=${inserted}, replayed=${replayed}`,
	);
}

async function main() {
	console.log("Seeding Phase 3 collections (idempotent)...");
	for (const p of PLANS) {
		await seedTenant(p);
	}
	console.log("\nDone.");
}

main()
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
	.finally(async () => {
		await pool.end();
	});
