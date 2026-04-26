/**
 * Phase 3 acceptance test, runs against a `pnpm dev` server on localhost:3000.
 * Re-uses the demo tenants from `pnpm db:seed`.
 *
 *   1. Geofence: a collection inside the radius is accepted; outside is 422.
 *   2. Idempotency: two POSTs with the same client_uuid produce the same row,
 *      the second is 200 (replayed) not 201.
 *   3. Cross-tenant: agent in one tenant cannot collect against a customer in
 *      another tenant (404, never 200).
 *   4. Rate limit: 11 collections in a row trigger 429 with Retry-After.
 *   5. Reversal: agent cannot reverse, manager can; double-reverse is 409.
 *   6. Audit chain: still verifies after all the above writes.
 *
 *   pnpm verify:phase3
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pool } from "@/db/client";
import { customers, tenants } from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { verifyChain } from "@/lib/audit/chain";

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

async function main() {
	// admin login is just a sanity check that the demo seed is intact.
	void (await login("admin@acme.test", "Passw0rd!"));
	const acmeManager = await login("manager@acme.test", "Passw0rd!");
	const acmeAgent = await login("agent1@acme.test", "Passw0rd!");
	const globexAgent = await login("agent1@globex.test", "Passw0rd!");

	// Pick a customer assigned to acmeAgent.
	const acmeTid = acmeAgent.user.tenantId;
	const [acmeCustomer] = await withTenant(acmeTid, async (tx) =>
		tx
			.select()
			.from(customers)
			.where(eq(customers.assignedAgentId, acmeAgent.user.id))
			.limit(1),
	);
	if (!acmeCustomer) throw new Error("no acme customer assigned to agent1");

	const [globexT] = await withoutTenant(async (tx) =>
		tx.select().from(tenants).where(eq(tenants.slug, "globex")),
	);
	const [globexCustomer] = await withTenant(globexT.id, async (tx) =>
		tx.select().from(customers).limit(1),
	);

	console.log("1. Geofence: inside vs outside the customer radius");
	{
		const inside = await authed("/api/collections", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				clientUuid: randomUUID(),
				customerId: acmeCustomer.id,
				amount: 100,
				paymentMode: "cash",
				collectionLat: acmeCustomer.lat + 0.0001, // ~11m
				collectionLng: acmeCustomer.lng + 0.0001,
				gpsAccuracyM: 10,
			}),
		});
		check("inside-radius is 201", inside.status === 201, `status=${inside.status}`);

		const outside = await authed("/api/collections", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				clientUuid: randomUUID(),
				customerId: acmeCustomer.id,
				amount: 100,
				paymentMode: "cash",
				collectionLat: acmeCustomer.lat + 0.05, // ~5km
				collectionLng: acmeCustomer.lng,
				gpsAccuracyM: 10,
			}),
		});
		check("outside-radius is 422", outside.status === 422, `status=${outside.status}`);
		const outsideJson = await outside.json();
		check(
			"422 includes geofence_violation code",
			outsideJson.error?.code === "geofence_violation",
		);
	}

	console.log("\n2. Idempotency: same clientUuid replays");
	{
		const cu = randomUUID();
		const first = await authed("/api/collections", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				clientUuid: cu,
				customerId: acmeCustomer.id,
				amount: 250,
				paymentMode: "upi",
				refNo: "T-IDEM-1",
				collectionLat: acmeCustomer.lat,
				collectionLng: acmeCustomer.lng,
				gpsAccuracyM: 8,
			}),
		});
		const f = await first.json();
		check("first POST is 201", first.status === 201);
		const second = await authed("/api/collections", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				clientUuid: cu,
				customerId: acmeCustomer.id,
				amount: 250,
				paymentMode: "upi",
				refNo: "T-IDEM-1",
				collectionLat: acmeCustomer.lat,
				collectionLng: acmeCustomer.lng,
				gpsAccuracyM: 8,
			}),
		});
		const s = await second.json();
		check("second POST is 200 (replay)", second.status === 200);
		check(
			"replay returns same collection id",
			f.collection?.id === s.collection?.id,
		);
		check("replay flag is true", s.replayed === true);
	}

	console.log("\n3. Cross-tenant collection POST is 404");
	{
		const r = await authed("/api/collections", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				clientUuid: randomUUID(),
				customerId: globexCustomer.id,
				amount: 100,
				paymentMode: "cash",
				collectionLat: globexCustomer.lat,
				collectionLng: globexCustomer.lng,
				gpsAccuracyM: 8,
			}),
		});
		check("cross-tenant POST is 404", r.status === 404, `status=${r.status}`);
		void globexAgent; // ensure both logins succeeded earlier
	}

	console.log("\n4. Rate limit: 12 rapid posts -> at least one 429");
	{
		const promises = Array.from({ length: 12 }).map(() =>
			authed("/api/collections", acmeAgent.accessToken, {
				method: "POST",
				body: JSON.stringify({
					clientUuid: randomUUID(),
					customerId: acmeCustomer.id,
					amount: 25,
					paymentMode: "cash",
					collectionLat: acmeCustomer.lat,
					collectionLng: acmeCustomer.lng,
					gpsAccuracyM: 10,
				}),
			}),
		);
		const results = await Promise.all(promises);
		const codes = results.map((r) => r.status);
		check(
			"saw at least one 429",
			codes.includes(429),
			`statuses=${codes.join(",")}`,
		);
		const limited = results.find((r) => r.status === 429);
		if (limited) {
			check(
				"429 has Retry-After header",
				!!limited.headers.get("retry-after"),
				limited.headers.get("retry-after") ?? "missing",
			);
		}
	}

	console.log("\n5. Reversal: agent forbidden, manager allowed, double-reverse 409");
	{
		// Pick a recent collection.
		const list = await authed("/api/collections?limit=5", acmeManager.accessToken);
		const ls = await list.json();
		const target = ls.collections?.[0];
		check("can list a collection to reverse", !!target);
		if (!target) return;

		const agentTry = await authed(
			`/api/collections/${target.id}/reversal`,
			acmeAgent.accessToken,
			{ method: "POST", body: JSON.stringify({ reason: "agent attempt" }) },
		);
		check("agent reversal is 403", agentTry.status === 403, `got ${agentTry.status}`);

		const mgrTry = await authed(
			`/api/collections/${target.id}/reversal`,
			acmeManager.accessToken,
			{ method: "POST", body: JSON.stringify({ reason: "verify-phase3 test" }) },
		);
		check("manager reversal is 201", mgrTry.status === 201, `got ${mgrTry.status}`);

		const mgrAgain = await authed(
			`/api/collections/${target.id}/reversal`,
			acmeManager.accessToken,
			{ method: "POST", body: JSON.stringify({ reason: "second attempt" }) },
		);
		check(
			"second reversal is 409 already_reversed",
			mgrAgain.status === 409,
			`got ${mgrAgain.status}`,
		);
	}

	console.log("\n6. Audit chain still intact after all writes");
	{
		const result = await withTenant(acmeTid, (tx) =>
			verifyChain(tx, acmeTid),
		);
		check(
			`acme chain ok (${result.rows} rows)`,
			result.ok,
			result.ok ? undefined : result.reason,
		);
		// Note: a previous run of verify-phase1 deliberately tampers the chain.
		// If you see a fail here, run pnpm db:seed to reset, then this script.
	}

	console.log(`\n${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

main()
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
	.finally(async () => {
		await pool.end();
	});
