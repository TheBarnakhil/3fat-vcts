/**
 * Phase 6 acceptance test for the offline-sync surface. Runs against a
 * `pnpm dev` server on localhost:3000 and re-uses the demo tenants from
 * `pnpm db:seed`.
 *
 * What it covers:
 *   1. Push happy-path: a 3-record batch returns 3 "created" outcomes
 *      and one of them gets a fresh receipt number.
 *   2. Idempotency: replaying the same clientUuid in a second batch
 *      returns "duplicate" (no double-insert).
 *   3. Partial failure: a batch with one bad row (geofence violation)
 *      still creates the others and reports "rejected" for the bad one.
 *   4. Drift detection: a record whose lastKnownOutstanding is more
 *      than 10% off the server's current balance gets supervisorReview.
 *   5. Pull cursor: first call without `since` returns customers; a
 *      second call with the returned cursor returns no customers.
 *   6. Tenant isolation: a globex agent's pull never includes acme rows.
 *
 *   pnpm verify:phase6
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { customers, supervisorReviews } from "@/db/schema";
import { withTenant } from "@/db/tenant";

const BASE = process.env.VCTS_BASE_URL ?? "http://localhost:3000";

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

type LoginResponse = {
	accessToken: string;
	refreshToken: string;
	user: { id: string; tenantId: string; tenantSlug: string; email: string; role: string };
};

async function login(email: string, password: string): Promise<LoginResponse> {
	const r = await fetch(`${BASE}/api/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	if (!r.ok) throw new Error(`login failed for ${email}: ${r.status} ${await r.text()}`);
	return r.json();
}

async function authed(
	path: string,
	token: string,
	init?: RequestInit,
): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			...(init?.headers ?? {}),
		},
	});
}

type PushOutcome = {
	clientUuid: string;
	status: "created" | "duplicate" | "rejected";
	collection?: { id: string; receiptNo: string };
	supervisorReview?: boolean;
	error?: { code: string; message: string };
};

type PushResponse = {
	outcomes: PushOutcome[];
	counts: {
		created: number;
		duplicate: number;
		rejected: number;
		supervisorReview: number;
	};
};

type PullResponse = {
	cursor: string;
	hasMore: boolean;
	customers: Array<{ id: string; name: string; updatedAt: string }>;
	collections: Array<{ id: string; clientUuid: string | null }>;
};

async function main() {
	const acmeAgent = await login("agent1@acme.test", "Passw0rd!");
	const globexAgent = await login("agent1@globex.test", "Passw0rd!");

	// Pick an acme customer assigned to acmeAgent so all geofence checks
	// share the same baseline lat/lng.
	const acmeTid = acmeAgent.user.tenantId;
	const [acmeCustomer] = await withTenant(acmeTid, async (tx) =>
		tx
			.select()
			.from(customers)
			.where(eq(customers.assignedAgentId, acmeAgent.user.id))
			.limit(1),
	);
	if (!acmeCustomer) throw new Error("no acme customer assigned to agent1");

	console.log("1. Push happy-path: 3 records inside the fence");
	const ids = [randomUUID(), randomUUID(), randomUUID()];
	{
		const r = await authed("/api/sync/push", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				records: ids.map((id, i) => ({
					clientUuid: id,
					customerId: acmeCustomer.id,
					amount: 50 + i,
					paymentMode: "cash",
					collectionLat: acmeCustomer.lat + 0.0001,
					collectionLng: acmeCustomer.lng + 0.0001,
					gpsAccuracyM: 10,
				})),
			}),
		});
		check("push returns 200", r.status === 200, `status=${r.status}`);
		const body = (await r.json()) as PushResponse;
		check("3 created", body.counts.created === 3, JSON.stringify(body.counts));
		check(
			"every outcome has a receipt number",
			body.outcomes.every((o) => o.status !== "rejected" && o.collection?.receiptNo),
		);
	}

	console.log("\n2. Idempotency: replaying the same UUIDs returns duplicates");
	{
		const r = await authed("/api/sync/push", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				records: ids.map((id) => ({
					clientUuid: id,
					customerId: acmeCustomer.id,
					amount: 50,
					paymentMode: "cash",
					collectionLat: acmeCustomer.lat + 0.0001,
					collectionLng: acmeCustomer.lng + 0.0001,
					gpsAccuracyM: 10,
				})),
			}),
		});
		const body = (await r.json()) as PushResponse;
		check("3 duplicates", body.counts.duplicate === 3, JSON.stringify(body.counts));
		check("0 created", body.counts.created === 0);
	}

	console.log("\n3. Partial failure: one bad row + two good");
	{
		const goodA = randomUUID();
		const goodB = randomUUID();
		const bad = randomUUID();
		const r = await authed("/api/sync/push", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				records: [
					{
						clientUuid: goodA,
						customerId: acmeCustomer.id,
						amount: 11,
						paymentMode: "cash",
						collectionLat: acmeCustomer.lat,
						collectionLng: acmeCustomer.lng,
						gpsAccuracyM: 10,
					},
					{
						clientUuid: bad,
						customerId: acmeCustomer.id,
						amount: 22,
						paymentMode: "cash",
						// 5 km away - guaranteed geofence violation.
						collectionLat: acmeCustomer.lat + 0.05,
						collectionLng: acmeCustomer.lng,
						gpsAccuracyM: 10,
					},
					{
						clientUuid: goodB,
						customerId: acmeCustomer.id,
						amount: 33,
						paymentMode: "cash",
						collectionLat: acmeCustomer.lat,
						collectionLng: acmeCustomer.lng,
						gpsAccuracyM: 10,
					},
				],
			}),
		});
		const body = (await r.json()) as PushResponse;
		check("2 created", body.counts.created === 2, JSON.stringify(body.counts));
		check("1 rejected", body.counts.rejected === 1);
		const rejected = body.outcomes.find((o) => o.status === "rejected");
		check(
			"rejected has geofence_violation code",
			rejected?.error?.code === "geofence_violation",
			rejected?.error?.code,
		);
	}

	console.log("\n4. Drift detection raises supervisorReview");
	{
		// Refetch current outstanding to compute a deliberately-stale value.
		const [currentCust] = await withTenant(acmeTid, async (tx) =>
			tx.select().from(customers).where(eq(customers.id, acmeCustomer.id)),
		);
		const stale = currentCust.outstandingBalance + 10_000; // > 10% drift
		const driftId = randomUUID();
		const r = await authed("/api/sync/push", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				records: [
					{
						clientUuid: driftId,
						customerId: acmeCustomer.id,
						amount: 1,
						paymentMode: "cash",
						collectionLat: acmeCustomer.lat,
						collectionLng: acmeCustomer.lng,
						gpsAccuracyM: 10,
						lastKnownOutstanding: stale,
					},
				],
			}),
		});
		const body = (await r.json()) as PushResponse;
		check("1 created", body.counts.created === 1);
		check(
			"supervisorReview flag set",
			body.outcomes[0]?.supervisorReview === true,
			JSON.stringify(body.outcomes[0]),
		);
		// Confirm a row landed in supervisor_reviews.
		const reviews = await withTenant(acmeTid, async (tx) =>
			tx
				.select()
				.from(supervisorReviews)
				.where(eq(supervisorReviews.collectionId, body.outcomes[0]!.collection!.id)),
		);
		check("supervisor_reviews row created", reviews.length === 1);
	}

	console.log("\n5. Pull cursor: subsequent call returns nothing new");
	let cursor: string;
	{
		const r1 = await authed("/api/sync/pull", acmeAgent.accessToken);
		check("first pull 200", r1.status === 200);
		const b1 = (await r1.json()) as PullResponse;
		check("first pull returns customers", b1.customers.length > 0);
		cursor = b1.cursor;
	}
	{
		const r2 = await authed(
			`/api/sync/pull?since=${encodeURIComponent(cursor)}`,
			acmeAgent.accessToken,
		);
		const b2 = (await r2.json()) as PullResponse;
		check(
			"second pull returns no customers",
			b2.customers.length === 0,
			`got ${b2.customers.length}`,
		);
	}

	console.log("\n6. Tenant isolation: globex pull never sees acme rows");
	{
		const r = await authed("/api/sync/pull", globexAgent.accessToken);
		const b = (await r.json()) as PullResponse;
		const acmeIds = new Set<string>();
		await withTenant(acmeTid, async (tx) => {
			const rows = await tx.select({ id: customers.id }).from(customers);
			for (const row of rows) acmeIds.add(row.id);
		});
		const leaked = b.customers.find((c) => acmeIds.has(c.id));
		check("no acme customers leaked into globex pull", leaked === undefined);
	}

	console.log(`\nPhase 6 verify: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
