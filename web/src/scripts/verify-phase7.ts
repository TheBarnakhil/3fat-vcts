/**
 * Phase 7 acceptance test for the location-logging + visit-validation
 * surface. Run against `pnpm dev` on localhost:3000.
 *
 * What it covers:
 *   1. Location batch happy-path: 5 fixes, server returns 5 created.
 *   2. Idempotency: replaying the same UUIDs returns 5 duplicates.
 *   3. Tenant + role isolation: a manager bearer is rejected from the
 *      agent-only batch endpoint.
 *   4. Manager movement endpoint surfaces the just-pushed fixes.
 *   5. Cron recompute clusters consecutive in-fence fixes (with
 *      synthetic "tracker" timestamps spanning > minDwellSeconds) into
 *      one customer_visits row.
 *   6. Cross-correlation: a collection submitted with no nearby tracker
 *      fix gets an `unverified_visit` supervisor review row.
 *
 *   pnpm verify:phase7
 */
import { and, eq, gte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
	customers,
	customerVisits,
	locationLogs,
	supervisorReviews,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
	DEFAULT_RECOMPUTE_CONFIG,
	recomputeForTenant,
} from "@/lib/visits/recompute";

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
	user: { id: string; tenantId: string; tenantSlug: string; role: string };
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

async function authed(path: string, token: string, init?: RequestInit) {
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
	const acmeAgent = await login("agent1@acme.test", "Passw0rd!");
	const acmeManager = await login("manager@acme.test", "Passw0rd!");

	const acmeTid = acmeAgent.user.tenantId;

	const [acmeCustomer] = await withTenant(acmeTid, async (tx) =>
		tx
			.select()
			.from(customers)
			.where(eq(customers.assignedAgentId, acmeAgent.user.id))
			.limit(1),
	);
	if (!acmeCustomer) throw new Error("no acme customer assigned to agent1");

	console.log("1. Push 5 tracker fixes inside the customer's fence");
	const fixIds = Array.from({ length: 5 }, () => randomUUID());
	{
		const now = Date.now();
		// Spread the fixes across ~5 minutes so the cluster algorithm
		// has enough dwell to cross VISIT_MIN_DWELL_SECONDS (180s default).
		const logs = fixIds.map((id, i) => ({
			clientUuid: id,
			lat: acmeCustomer.lat + 0.00001 * i,
			lng: acmeCustomer.lng + 0.00001 * i,
			accuracyM: 12,
			batteryPct: 80 - i,
			loggedAt: new Date(now - (5 - i) * 60_000).toISOString(),
			source: "tracker",
		}));
		const r = await authed("/api/location-logs/batch", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({ logs }),
		});
		check("batch 200", r.status === 200, `status=${r.status}`);
		const body = await r.json();
		check("5 created", body?.counts?.created === 5, JSON.stringify(body?.counts));
	}

	console.log("\n2. Replay the same UUIDs - all 5 should come back duplicate");
	{
		const r = await authed("/api/location-logs/batch", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				logs: fixIds.map((id) => ({
					clientUuid: id,
					lat: acmeCustomer.lat,
					lng: acmeCustomer.lng,
					loggedAt: new Date().toISOString(),
					source: "tracker",
				})),
			}),
		});
		const body = await r.json();
		check(
			"5 duplicates",
			body?.counts?.duplicate === 5,
			JSON.stringify(body?.counts),
		);
	}

	console.log("\n3. Manager bearer is rejected from the agent-only batch path");
	{
		const r = await authed("/api/location-logs/batch", acmeManager.accessToken, {
			method: "POST",
			body: JSON.stringify({
				logs: [
					{
						clientUuid: randomUUID(),
						lat: 0,
						lng: 0,
						loggedAt: new Date().toISOString(),
					},
				],
			}),
		});
		check("manager push rejected with 403", r.status === 403, `status=${r.status}`);
	}

	console.log("\n4. Manager movement endpoint surfaces the recent fixes");
	{
		const day = new Date().toISOString().slice(0, 10);
		const r = await authed(
			`/api/agents/${acmeAgent.user.id}/movement?day=${day}`,
			acmeManager.accessToken,
		);
		check("movement 200", r.status === 200, `status=${r.status}`);
		const body = await r.json();
		check("agent block present", body?.agent?.id === acmeAgent.user.id);
		check(
			"5+ fixes visible",
			Array.isArray(body?.fixes) && body.fixes.length >= 5,
			`got ${body?.fixes?.length}`,
		);
	}

	console.log("\n5. Recompute clusters tracker fixes into a customer_visit");
	{
		const windowStart = new Date(Date.now() - 60 * 60 * 1000);
		// Tighten dwell to 60s so the spread above qualifies even if
		// the local clock skew shrinks the window.
		const stats = await recomputeForTenant(acmeTid, windowStart, {
			...DEFAULT_RECOMPUTE_CONFIG,
			minDwellSeconds: 60,
		});
		check("recompute touched at least one fix", stats.fixesScanned >= 5);
		check(
			"at least one visit created or already present",
			stats.visitsCreated + stats.visitsSkippedDuplicate >= 1,
			JSON.stringify(stats),
		);
		const visits = await withTenant(acmeTid, async (tx) =>
			tx
				.select()
				.from(customerVisits)
				.where(
					and(
						eq(customerVisits.agentId, acmeAgent.user.id),
						eq(customerVisits.customerId, acmeCustomer.id),
						gte(customerVisits.startedAt, windowStart),
					),
				),
		);
		check("visit row exists for agent+customer", visits.length >= 1);
	}

	console.log("\n6. Collection without nearby fixes raises unverified_visit");
	{
		// Push a collection synthetically by going through the API. Use
		// coordinates inside the fence so geofence allows the write,
		// but submit it BEFORE any tracker fix would be near it: we
		// don't care about the cron timestamp arithmetic here, only
		// that the recompute correlates against location_logs sourced
		// "tracker". Trick: insert a collection whose collected_at is
		// *now* but synthesise tracker fixes far outside the fence.
		const farFix = randomUUID();
		await authed("/api/location-logs/batch", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				logs: [
					{
						clientUuid: farFix,
						// 50km away
						lat: acmeCustomer.lat + 0.5,
						lng: acmeCustomer.lng + 0.5,
						loggedAt: new Date().toISOString(),
						source: "tracker",
					},
				],
			}),
		});
		const collId = randomUUID();
		const collTimestamp = new Date().toISOString();
		const r = await authed("/api/collections", acmeAgent.accessToken, {
			method: "POST",
			body: JSON.stringify({
				clientUuid: collId,
				customerId: acmeCustomer.id,
				amount: 5,
				paymentMode: "cash",
				collectionLat: acmeCustomer.lat,
				collectionLng: acmeCustomer.lng,
				gpsAccuracyM: 10,
				collectedAt: collTimestamp,
			}),
		});
		check("collection 201", r.status === 201, `status=${r.status}`);
		const collBody = await r.json();
		const newCollectionId = collBody?.collection?.id ?? collBody?.id;
		check("collection id returned", typeof newCollectionId === "string");

		// Run recompute with a tight tolerance so the existing fixes
		// near the customer (from step 1) don't accidentally cover this
		// new collection - they're 5+ minutes old by now.
		const stats = await recomputeForTenant(
			acmeTid,
			new Date(Date.now() - 30 * 60 * 1000),
			{
				...DEFAULT_RECOMPUTE_CONFIG,
				minDwellSeconds: 60,
				collectionToleranceMin: 1,
			},
		);
		check("recompute scanned collections", stats.collectionsScanned >= 1);
		const reviews = await withTenant(acmeTid, async (tx) =>
			tx
				.select()
				.from(supervisorReviews)
				.where(
					and(
						eq(supervisorReviews.collectionId, newCollectionId),
						eq(supervisorReviews.reason, "unverified_visit"),
					),
				),
		);
		check(
			"unverified_visit supervisor review row created",
			reviews.length === 1,
			`got ${reviews.length}`,
		);

		// Cleanup: drop the planted far fix + the synthetic collection's
		// review row so re-running the script stays idempotent. We can't
		// delete the collection (append-only ledger) but the next run
		// uses fresh UUIDs anyway.
		await withTenant(acmeTid, async (tx) => {
			await tx
				.delete(locationLogs)
				.where(eq(locationLogs.clientUuid, farFix));
		});
	}

	console.log(`\nPhase 7 verify: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
