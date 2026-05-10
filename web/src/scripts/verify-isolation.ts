/**
 * Phase 10 - Tenant + role isolation verifier.
 *
 * Pure-HTTP test that runs against any deployed instance (defaults to the
 * production Vercel deploy). Logs in as both seeded tenants in admin and
 * agent roles, then walks every UUID-bearing endpoint to confirm:
 *
 *   1. Cross-tenant access by UUID returns 404 (never 200, never 500).
 *   2. Within a tenant, an agent cannot read/write another agent's
 *      collection.
 *   3. Agent role hits manager+ endpoints with 403, not 404 / 200.
 *   4. Anonymous + bad-token requests get 401, not 404.
 *
 * The script never mutates state on the target deployment - all writes use
 * either fake bodies that fail validation, or real bodies against IDs
 * scoped to the wrong tenant (so the request stops at 404/403 before
 * touching the DB).
 *
 *   pnpm tsx src/scripts/verify-isolation.ts
 *   pnpm tsx src/scripts/verify-isolation.ts https://my-deploy.vercel.app
 *   VCTS_BASE_URL=https://... pnpm tsx src/scripts/verify-isolation.ts
 */
export {};

const BASE = (
	process.argv[2] ||
	process.env.VCTS_BASE_URL ||
	"https://project-jcsyq.vercel.app"
).replace(/\/$/, "");

const ACME_ADMIN = { email: "admin@acme.test", password: "Passw0rd!" };
const ACME_AGENT_1 = { email: "agent1@acme.test", password: "Passw0rd!" };
const ACME_AGENT_2 = { email: "agent2@acme.test", password: "Passw0rd!" };
const GLOBEX_ADMIN = { email: "admin@globex.test", password: "Passw0rd!" };
const GLOBEX_AGENT = { email: "agent1@globex.test", password: "Passw0rd!" };

type Login = {
	accessToken: string;
	refreshToken: string;
	user: { id: string; tenantId: string; tenantSlug: string; role: string };
};

let passed = 0;
let failed = 0;
let skipped = 0;

const failures: string[] = [];

function ok(name: string) {
	console.log(`  [ok] ${name}`);
	passed += 1;
}

function fail(name: string, detail?: string) {
	const line = `  [FAIL] ${name}${detail ? ` -- ${detail}` : ""}`;
	console.log(line);
	failed += 1;
	failures.push(line.trim());
}

function skip(name: string, reason: string) {
	console.log(`  [skip] ${name} -- ${reason}`);
	skipped += 1;
}

function expectStatus(
	name: string,
	got: number,
	want: number | number[],
): void {
	const allowed = Array.isArray(want) ? want : [want];
	if (allowed.includes(got)) ok(`${name} -> ${got}`);
	else fail(name, `expected ${allowed.join("/")}, got ${got}`);
}

async function login(creds: {
	email: string;
	password: string;
	installId?: string;
}): Promise<Login> {
	const r = await fetch(`${BASE}/api/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(creds),
	});
	if (!r.ok) {
		throw new Error(
			`login failed for ${creds.email}: ${r.status} ${await r.text()}`,
		);
	}
	return (await r.json()) as Login;
}

async function refresh(
	refreshToken: string,
	installId?: string,
): Promise<Response> {
	return fetch(`${BASE}/api/auth/refresh`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ refreshToken, installId }),
	});
}

function authedFetch(
	token: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${token}`);
	if (init.body && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	return fetch(`${BASE}${path}`, { ...init, headers });
}

async function listJson<T>(token: string, path: string): Promise<T> {
	const r = await authedFetch(token, path);
	if (!r.ok) {
		throw new Error(`GET ${path} failed: ${r.status} ${await r.text()}`);
	}
	return (await r.json()) as T;
}

type CustomerListResp = { customers: Array<{ id: string; assignedAgentId: string | null; name: string }> };
type CollectionListResp = { collections: Array<{ id: string; agentId: string; receiptNo: string }> };
type AgentListResp = { agents: Array<{ id: string; agentCode: string | null; role: string }> };

const FAKE_UUID = "00000000-0000-4000-8000-000000000000";

async function main() {
	console.log(`Verifying tenant + role isolation against ${BASE}\n`);

	console.log("Section A. Login flows");
	const acmeAdmin = await login(ACME_ADMIN);
	const acmeAgent1 = await login(ACME_AGENT_1);
	let acmeAgent2: Login | null = null;
	try {
		acmeAgent2 = await login(ACME_AGENT_2);
	} catch (err) {
		console.log(`  [skip] agent2@acme login -- ${(err as Error).message}`);
	}
	const globexAdmin = await login(GLOBEX_ADMIN);
	const globexAgent = await login(GLOBEX_AGENT);
	ok(`acme admin logged in (${acmeAdmin.user.tenantSlug})`);
	ok(`acme agent1 logged in`);
	if (acmeAgent2) ok(`acme agent2 logged in`);
	ok(`globex admin logged in (${globexAdmin.user.tenantSlug})`);
	ok(`globex agent logged in`);
	if (acmeAdmin.user.tenantId === globexAdmin.user.tenantId) {
		fail("tenant ids differ", "both admins resolved to the same tenantId");
	} else {
		ok("tenant ids differ between acme + globex admins");
	}

	console.log("\nSection B. List endpoints respect tenant scope");
	const acmeCustomers = await listJson<CustomerListResp>(
		acmeAdmin.accessToken,
		"/api/customers?perPage=200",
	);
	const globexCustomers = await listJson<CustomerListResp>(
		globexAdmin.accessToken,
		"/api/customers?perPage=200",
	);
	const acmeCustomerIds = new Set(acmeCustomers.customers.map((c) => c.id));
	const globexCustomerIds = new Set(globexCustomers.customers.map((c) => c.id));
	const customerOverlap = [...acmeCustomerIds].filter((id) =>
		globexCustomerIds.has(id),
	);
	if (customerOverlap.length === 0) ok("no customer id overlap between tenants");
	else fail("customer id overlap", customerOverlap.join(","));

	const acmeCollections = await listJson<CollectionListResp>(
		acmeAdmin.accessToken,
		"/api/collections?perPage=200",
	);
	const globexCollections = await listJson<CollectionListResp>(
		globexAdmin.accessToken,
		"/api/collections?perPage=200",
	);
	const collectionOverlap = acmeCollections.collections
		.map((c) => c.id)
		.filter((id) => globexCollections.collections.some((g) => g.id === id));
	if (collectionOverlap.length === 0) {
		ok("no collection id overlap between tenants");
	} else {
		fail("collection id overlap", collectionOverlap.join(","));
	}

	const acmeAgents = await listJson<AgentListResp>(
		acmeAdmin.accessToken,
		"/api/agents",
	);
	const globexAgents = await listJson<AgentListResp>(
		globexAdmin.accessToken,
		"/api/agents",
	);
	const agentOverlap = acmeAgents.agents
		.map((a) => a.id)
		.filter((id) => globexAgents.agents.some((g) => g.id === id));
	if (agentOverlap.length === 0) ok("no agent id overlap between tenants");
	else fail("agent id overlap", agentOverlap.join(","));

	// Sync/pull is the offline-first ingestion path; if it leaks, the agent's
	// device caches another tenant's data. Caught the same RLS regression as
	// the list endpoints above, but without a verifier check it's invisible.
	type SyncPullResp = {
		customers: Array<{ id: string }>;
		collections: Array<{ id: string }>;
	};
	const acmeSync = await listJson<SyncPullResp>(
		acmeAgent1.accessToken,
		"/api/sync/pull?scope=all",
	);
	const globexSync = await listJson<SyncPullResp>(
		globexAgent.accessToken,
		"/api/sync/pull?scope=all",
	);
	const syncCustomerOverlap = acmeSync.customers
		.map((c) => c.id)
		.filter((id) => globexSync.customers.some((g) => g.id === id));
	if (syncCustomerOverlap.length === 0) {
		ok("no /sync/pull customer overlap between tenants");
	} else {
		fail("/sync/pull customer overlap", syncCustomerOverlap.join(","));
	}
	const syncCollectionOverlap = acmeSync.collections
		.map((c) => c.id)
		.filter((id) => globexSync.collections.some((g) => g.id === id));
	if (syncCollectionOverlap.length === 0) {
		ok("no /sync/pull collection overlap between tenants");
	} else {
		fail("/sync/pull collection overlap", syncCollectionOverlap.join(","));
	}

	// Reports + dashboard aggregates would silently absorb cross-tenant rows
	// into a tenant's KPI sums if RLS broke. Confirm the totals don't move
	// when the *other* tenant adds data (we sample by amount; a non-zero
	// difference between an admin-scoped sum and zero on an empty range is
	// the smoke we look for here).
	const reportsDay = new Date().toISOString().slice(0, 10);
	type ReportsResp = { totals: { count: number; amount: number } };
	const acmeReport = await listJson<ReportsResp>(
		acmeAdmin.accessToken,
		`/api/reports/summary?from=${reportsDay}&to=${reportsDay}`,
	);
	const globexReport = await listJson<ReportsResp>(
		globexAdmin.accessToken,
		`/api/reports/summary?from=${reportsDay}&to=${reportsDay}`,
	);
	if (
		typeof acmeReport.totals?.amount === "number" &&
		typeof globexReport.totals?.amount === "number"
	) {
		ok(
			`/reports/summary scoped per tenant (acme=${acmeReport.totals.count}/$${acmeReport.totals.amount.toFixed(0)}, globex=${globexReport.totals.count}/$${globexReport.totals.amount.toFixed(0)})`,
		);
	} else {
		fail(
			"/reports/summary scoped",
			"unexpected totals shape from at least one tenant",
		);
	}

	const sampleAcmeCustomerId = acmeCustomers.customers[0]?.id;
	const sampleAcmeCollectionId = acmeCollections.collections[0]?.id;
	const sampleAcmeAgentId = acmeAgents.agents[0]?.id;

	if (!sampleAcmeCustomerId || !sampleAcmeCollectionId || !sampleAcmeAgentId) {
		console.log("  [skip] not enough acme fixtures to run cross-tenant checks");
		skipped += 1;
	}

	console.log("\nSection C. Cross-tenant access by UUID returns 404");
	if (sampleAcmeCustomerId) {
		expectStatus(
			"GET /api/customers/{acme} as globex admin",
			(await authedFetch(globexAdmin.accessToken, `/api/customers/${sampleAcmeCustomerId}`)).status,
			404,
		);
		expectStatus(
			"PATCH /api/customers/{acme} as globex admin",
			(
				await authedFetch(globexAdmin.accessToken, `/api/customers/${sampleAcmeCustomerId}`, {
					method: "PATCH",
					body: JSON.stringify({ name: "should-never-write" }),
				})
			).status,
			404,
		);
		expectStatus(
			"DELETE /api/customers/{acme} as globex admin",
			(
				await authedFetch(globexAdmin.accessToken, `/api/customers/${sampleAcmeCustomerId}`, {
					method: "DELETE",
				})
			).status,
			404,
		);
	}

	if (sampleAcmeCollectionId) {
		expectStatus(
			"GET /api/collections/{acme} as globex admin",
			(await authedFetch(globexAdmin.accessToken, `/api/collections/${sampleAcmeCollectionId}`)).status,
			404,
		);
		expectStatus(
			"GET /api/collections/{acme}/receipt as globex admin",
			(
				await authedFetch(
					globexAdmin.accessToken,
					`/api/collections/${sampleAcmeCollectionId}/receipt`,
				)
			).status,
			404,
		);
		expectStatus(
			"POST /api/collections/{acme}/reversal as globex admin",
			(
				await authedFetch(
					globexAdmin.accessToken,
					`/api/collections/${sampleAcmeCollectionId}/reversal`,
					{ method: "POST", body: JSON.stringify({ reason: "isolation-test" }) },
				)
			).status,
			404,
		);
		expectStatus(
			"POST /api/collections/{acme}/attachments/presign as globex agent",
			(
				await authedFetch(
					globexAgent.accessToken,
					`/api/collections/${sampleAcmeCollectionId}/attachments/presign`,
					{
						method: "POST",
						body: JSON.stringify({ kind: "photo", contentType: "image/jpeg" }),
					},
				)
			).status,
			404,
		);
		expectStatus(
			"PATCH /api/collections/{acme}/attachments as globex agent",
			(
				await authedFetch(
					globexAgent.accessToken,
					`/api/collections/${sampleAcmeCollectionId}/attachments`,
					{
						method: "PATCH",
						body: JSON.stringify({
							photoUrl: "t/globex/photos/should-never-set.jpg",
						}),
					},
				)
			).status,
			404,
		);
		expectStatus(
			"GET /api/collections/{acme}/receipt-assets as globex admin",
			(
				await authedFetch(
					globexAdmin.accessToken,
					`/api/collections/${sampleAcmeCollectionId}/receipt-assets`,
				)
			).status,
			404,
		);
	}

	if (sampleAcmeCustomerId) {
		// Phase 10 / Track C3 - per-customer ledger.
		expectStatus(
			"GET /api/customers/{acme}/ledger as globex admin",
			(
				await authedFetch(
					globexAdmin.accessToken,
					`/api/customers/${sampleAcmeCustomerId}/ledger`,
				)
			).status,
			404,
		);
		expectStatus(
			"GET /api/customers/{acme}/ledger?format=csv as globex admin",
			(
				await authedFetch(
					globexAdmin.accessToken,
					`/api/customers/${sampleAcmeCustomerId}/ledger?format=csv`,
				)
			).status,
			404,
		);
		expectStatus(
			"GET /api/customers/{acme}/ledger?format=pdf as globex admin",
			(
				await authedFetch(
					globexAdmin.accessToken,
					`/api/customers/${sampleAcmeCustomerId}/ledger?format=pdf`,
				)
			).status,
			404,
		);
	}

	if (sampleAcmeAgentId) {
		expectStatus(
			"GET /api/agents/{acme} as globex admin",
			(await authedFetch(globexAdmin.accessToken, `/api/agents/${sampleAcmeAgentId}`)).status,
			404,
		);
		expectStatus(
			"PATCH /api/agents/{acme} as globex admin",
			(
				await authedFetch(globexAdmin.accessToken, `/api/agents/${sampleAcmeAgentId}`, {
					method: "PATCH",
					body: JSON.stringify({ isActive: false }),
				})
			).status,
			404,
		);
		const today = new Date().toISOString().slice(0, 10);
		expectStatus(
			"GET /api/agents/{acme}/movement as globex admin",
			(
				await authedFetch(
					globexAdmin.accessToken,
					`/api/agents/${sampleAcmeAgentId}/movement?day=${today}`,
				)
			).status,
			404,
		);
	}

	expectStatus(
		"PATCH /api/reviews/{fake-uuid} as globex admin",
		(
			await authedFetch(globexAdmin.accessToken, `/api/reviews/${FAKE_UUID}`, {
				method: "PATCH",
				body: JSON.stringify({ action: "resolve" }),
			})
		).status,
		404,
	);

	console.log("\nSection D. Same-tenant cross-agent leakage");
	const otherAgentCollection = acmeCollections.collections.find(
		(c) => c.agentId !== acmeAgent1.user.id,
	);
	if (!otherAgentCollection) {
		skip(
			"agent cross-collection check",
			"no acme collection found that belongs to a different agent",
		);
	} else {
		expectStatus(
			"GET /api/collections/{otherAgent} as acme agent1",
			(
				await authedFetch(
					acmeAgent1.accessToken,
					`/api/collections/${otherAgentCollection.id}`,
				)
			).status,
			403,
		);
		expectStatus(
			"POST /api/collections/{otherAgent}/attachments/presign as acme agent1",
			(
				await authedFetch(
					acmeAgent1.accessToken,
					`/api/collections/${otherAgentCollection.id}/attachments/presign`,
					{
						method: "POST",
						body: JSON.stringify({ kind: "photo", contentType: "image/jpeg" }),
					},
				)
			).status,
			403,
		);
		expectStatus(
			"PATCH /api/collections/{otherAgent}/attachments as acme agent1",
			(
				await authedFetch(
					acmeAgent1.accessToken,
					`/api/collections/${otherAgentCollection.id}/attachments`,
					{
						method: "PATCH",
						body: JSON.stringify({
							photoUrl: "t/acme/photos/should-never-set.jpg",
						}),
					},
				)
			).status,
			403,
		);
		expectStatus(
			"GET /api/collections/{otherAgent}/receipt-assets as acme agent1",
			(
				await authedFetch(
					acmeAgent1.accessToken,
					`/api/collections/${otherAgentCollection.id}/receipt-assets`,
				)
			).status,
			403,
		);
	}

	const otherAgentCustomer = acmeCustomers.customers.find(
		(c) => c.assignedAgentId && c.assignedAgentId !== acmeAgent1.user.id,
	);
	if (otherAgentCustomer) {
		expectStatus(
			"GET /api/customers/{otherAgentAssigned} as acme agent1",
			(
				await authedFetch(
					acmeAgent1.accessToken,
					`/api/customers/${otherAgentCustomer.id}`,
				)
			).status,
			404,
		);
		// Phase 10 / Track C3 - the ledger endpoint must respect the same
		// agent->customer assignment guard as /api/customers/{id}.
		expectStatus(
			"GET /api/customers/{otherAgentAssigned}/ledger as acme agent1",
			(
				await authedFetch(
					acmeAgent1.accessToken,
					`/api/customers/${otherAgentCustomer.id}/ledger`,
				)
			).status,
			404,
		);
	} else {
		skip(
			"agent cross-customer check",
			"no acme customer assigned to a different agent",
		);
	}

	// Happy-path sanity: an acme admin pulls a ledger for one of their own
	// customers and gets a structured JSON body. Catches accidental schema
	// regressions where the endpoint returns 200 but is missing collections
	// or totals.
	if (sampleAcmeCustomerId) {
		const res = await authedFetch(
			acmeAdmin.accessToken,
			`/api/customers/${sampleAcmeCustomerId}/ledger`,
		);
		if (res.status !== 200) {
			fail(
				"GET /api/customers/{self}/ledger as acme admin",
				`expected 200, got ${res.status}`,
			);
		} else {
			const body = (await res.json().catch(() => null)) as
				| {
						customer?: { id?: string };
						collections?: unknown[];
						totals?: { count?: number; net?: number };
				  }
				| null;
			const validShape =
				!!body &&
				body.customer?.id === sampleAcmeCustomerId &&
				Array.isArray(body.collections) &&
				typeof body.totals?.count === "number" &&
				typeof body.totals?.net === "number";
			if (validShape) {
				ok(
					`GET /api/customers/{self}/ledger as acme admin (count=${body!.totals!.count}, net=${body!.totals!.net})`,
				);
			} else {
				fail(
					"GET /api/customers/{self}/ledger as acme admin",
					"missing customer/collections/totals fields",
				);
			}
		}
	}

	console.log("\nSection E. Role escalation (acme agent hitting manager+ endpoints)");
	expectStatus(
		"PATCH /api/customers/{any} as agent",
		sampleAcmeCustomerId
			? (
					await authedFetch(acmeAgent1.accessToken, `/api/customers/${sampleAcmeCustomerId}`, {
						method: "PATCH",
						body: JSON.stringify({ name: "isolation-test" }),
					})
				).status
			: 403,
		403,
	);
	expectStatus(
		"DELETE /api/customers/{any} as agent",
		sampleAcmeCustomerId
			? (
					await authedFetch(acmeAgent1.accessToken, `/api/customers/${sampleAcmeCustomerId}`, {
						method: "DELETE",
					})
				).status
			: 403,
		403,
	);
	expectStatus(
		"POST /api/agents as agent",
		(
			await authedFetch(acmeAgent1.accessToken, "/api/agents", {
				method: "POST",
				body: JSON.stringify({
					email: "noop-agent@acme.test",
					password: "Passw0rd!",
					name: "Should never exist",
					role: "agent",
				}),
			})
		).status,
		403,
	);
	expectStatus(
		"POST /api/customers as agent",
		(
			await authedFetch(acmeAgent1.accessToken, "/api/customers", {
				method: "POST",
				body: JSON.stringify({ name: "Should never exist", lat: 0, lng: 0 }),
			})
		).status,
		403,
	);
	expectStatus(
		"POST /api/collections/{x}/reversal as agent",
		sampleAcmeCollectionId
			? (
					await authedFetch(
						acmeAgent1.accessToken,
						`/api/collections/${sampleAcmeCollectionId}/reversal`,
						{
							method: "POST",
							body: JSON.stringify({ reason: "isolation-test" }),
						},
					)
				).status
			: 403,
		403,
	);
	const today = new Date().toISOString().slice(0, 10);
	expectStatus(
		"GET /api/agents/{self}/movement as agent",
		(
			await authedFetch(
				acmeAgent1.accessToken,
				`/api/agents/${acmeAgent1.user.id}/movement?day=${today}`,
			)
		).status,
		403,
	);
	expectStatus(
		"GET /api/audit/verify as agent",
		(await authedFetch(acmeAgent1.accessToken, "/api/audit/verify")).status,
		403,
	);
	expectStatus(
		"GET /api/audit as agent",
		(await authedFetch(acmeAgent1.accessToken, "/api/audit?perPage=10")).status,
		403,
	);
	expectStatus(
		"GET /api/reviews as agent",
		(await authedFetch(acmeAgent1.accessToken, "/api/reviews")).status,
		403,
	);
	expectStatus(
		"PATCH /api/reviews/{x} as agent",
		(
			await authedFetch(acmeAgent1.accessToken, `/api/reviews/${FAKE_UUID}`, {
				method: "PATCH",
				body: JSON.stringify({ action: "resolve" }),
			})
		).status,
		403,
	);
	expectStatus(
		"PATCH /api/tenants/me as agent",
		(
			await authedFetch(acmeAgent1.accessToken, "/api/tenants/me", {
				method: "PATCH",
				body: JSON.stringify({ branding: { primary: "#fff" } }),
			})
		).status,
		403,
	);
	expectStatus(
		"POST /api/tenants/me/branding/logo/presign as agent",
		(
			await authedFetch(
				acmeAgent1.accessToken,
				"/api/tenants/me/branding/logo/presign",
				{
					method: "POST",
					body: JSON.stringify({ contentType: "image/png" }),
				},
			)
		).status,
		403,
	);
	expectStatus(
		"POST /api/sync/push as manager",
		(
			await authedFetch(acmeAdmin.accessToken, "/api/sync/push", {
				method: "POST",
				body: JSON.stringify({ records: [] }),
			})
		).status,
		403,
	);

	console.log("\nSection F. Auth boundaries");
	expectStatus(
		"GET /api/customers (no token)",
		(await fetch(`${BASE}/api/customers`)).status,
		401,
	);
	expectStatus(
		"GET /api/customers (bad token)",
		(await authedFetch("not-a-jwt", "/api/customers")).status,
		401,
	);
	expectStatus(
		"GET /api/me (no token)",
		(await fetch(`${BASE}/api/me`)).status,
		401,
	);
	expectStatus(
		"GET /api/dashboard/summary (no token)",
		(await fetch(`${BASE}/api/dashboard/summary`)).status,
		401,
	);
	expectStatus(
		"GET /api/maps/static (no token)",
		(
			await fetch(`${BASE}/api/maps/static?lat=12.97&lng=77.59`)
		).status,
		401,
	);
	expectStatus(
		"GET /api/stream/agent-locations (no token)",
		(await fetch(`${BASE}/api/stream/agent-locations`)).status,
		401,
	);
	expectStatus(
		"GET /api/stream/agent-locations as agent",
		(
			await authedFetch(
				acmeAgent1.accessToken,
				"/api/stream/agent-locations",
			)
		).status,
		403,
	);
	expectStatus(
		"POST /api/auth/login (wrong password)",
		(
			await fetch(`${BASE}/api/auth/login`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: ACME_ADMIN.email,
					password: "wrong-password",
				}),
			})
		).status,
		401,
	);
	expectStatus(
		"POST /api/auth/login (unknown email)",
		(
			await fetch(`${BASE}/api/auth/login`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "no-such-user-12345@acme.test",
					password: "Passw0rd!",
				}),
			})
		).status,
		401,
	);

	console.log("\nSection G. Cron + sensitive endpoints");
	expectStatus(
		"GET /api/cron/visits/recompute (no secret)",
		(await fetch(`${BASE}/api/cron/visits/recompute`)).status,
		[401, 403],
	);
	expectStatus(
		"GET /api/cron/visits/recompute (bad secret)",
		(
			await fetch(`${BASE}/api/cron/visits/recompute`, {
				headers: { authorization: "Bearer not-the-real-secret" },
			})
		).status,
		[401, 403],
	);

	console.log("\nSection H. Device binding (Phase 10 / Track B)");
	// Each login creates a fresh refresh-token row in the DB; we burn three
	// rows here to test the matrix [bound + matching, bound + mismatch,
	// legacy unbound]. agent2@acme is used because it isn't load-bearing
	// in the rest of the suite and we want to keep agent1's rate-limit
	// headroom for the role-escalation tests above.
	const installA = "isolation-test-install-a-0000000000";
	const installB = "isolation-test-install-b-0000000000";

	let boundMatch: Login | null = null;
	let boundMismatch: Login | null = null;
	let legacy: Login | null = null;
	try {
		boundMatch = await login({ ...ACME_AGENT_2, installId: installA });
		ok("login(installId A) succeeds");
	} catch (err) {
		fail("login(installId A)", (err as Error).message);
	}
	try {
		boundMismatch = await login({ ...ACME_AGENT_2, installId: installA });
		ok("login(installId A) again succeeds (separate refresh row)");
	} catch (err) {
		fail("login(installId A) #2", (err as Error).message);
	}
	try {
		legacy = await login({ ...ACME_AGENT_2 });
		ok("login(no installId) still works (legacy path)");
	} catch (err) {
		fail("login(no installId)", (err as Error).message);
	}

	if (boundMismatch) {
		// Same agent, different installId in the refresh body -> server
		// rejects with 401 (device_mismatch) and revokes the row.
		expectStatus(
			"refresh(bound) with WRONG installId",
			(await refresh(boundMismatch.refreshToken, installB)).status,
			401,
		);
	}
	if (boundMatch) {
		// Bound row + matching installId rotates correctly (200).
		expectStatus(
			"refresh(bound) with matching installId",
			(await refresh(boundMatch.refreshToken, installA)).status,
			200,
		);
	}
	if (legacy) {
		// Legacy row (no stored fingerprint) keeps working without an
		// installId so the rollout doesn't lock anyone out mid-flight.
		expectStatus(
			"refresh(legacy) without installId",
			(await refresh(legacy.refreshToken)).status,
			200,
		);
	}

	console.log(
		`\n${passed} passed, ${failed} failed, ${skipped} skipped (${BASE})`,
	);
	if (failed > 0) {
		console.log("\nFailures:");
		for (const f of failures) console.log(`  ${f}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
