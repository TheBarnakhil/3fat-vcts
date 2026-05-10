/**
 * Phase 11 platform-console verifier.
 *
 * Requires `pnpm db:seed:platform` to have created the platform admin.
 *
 *   pnpm verify:platform
 *   pnpm verify:platform https://my-deploy.vercel.app
 */
export {};

const BASE = (
	process.argv[2] ||
	process.env.VCTS_BASE_URL ||
	"https://project-jcsyq.vercel.app"
).replace(/\/$/, "");

const PLATFORM_ADMIN = {
	email: process.env.PLATFORM_ADMIN_EMAIL ?? "platform@3fat.test",
	password: process.env.PLATFORM_ADMIN_PASSWORD ?? "Passw0rd!",
};

const TENANT_ADMIN = { email: "admin@acme.test", password: "Passw0rd!" };
const SIGNUP_SLUG = `verify-${Date.now().toString(36)}`;

let passed = 0;
let failed = 0;

function ok(name: string) {
	console.log(`  [ok] ${name}`);
	passed += 1;
}

function fail(name: string, detail?: string) {
	console.log(`  [FAIL] ${name}${detail ? ` -- ${detail}` : ""}`);
	failed += 1;
}

function expectStatus(name: string, got: number, want: number) {
	if (got === want) ok(`${name} -> ${got}`);
	else fail(name, `expected ${want}, got ${got}`);
}

async function postJson(path: string, body: unknown, token?: string) {
	return fetch(`${BASE}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

async function get(path: string, token?: string) {
	return fetch(`${BASE}${path}`, {
		headers: token ? { authorization: `Bearer ${token}` } : undefined,
	});
}

async function main() {
	console.log(`Verifying platform console against ${BASE}`);

	console.log("\nSection A. Auth boundaries");
	expectStatus("GET /api/platform/me (no token)", (await get("/api/platform/me")).status, 401);
	expectStatus(
		"GET /api/platform/tenants (no token)",
		(await get("/api/platform/tenants")).status,
		401,
	);

	const tenantLogin = await postJson("/api/auth/login", TENANT_ADMIN);
	const tenantBody = (await tenantLogin.json()) as { accessToken?: string };
	if (!tenantBody.accessToken) {
		fail("tenant admin login", "missing access token");
		process.exit(1);
	}
	expectStatus(
		"tenant token cannot call /api/platform/me",
		(await get("/api/platform/me", tenantBody.accessToken)).status,
		401,
	);

	const platformLogin = await postJson("/api/platform/auth/login", PLATFORM_ADMIN);
	if (platformLogin.status !== 200) {
		fail(
			"platform admin login",
			`expected 200, got ${platformLogin.status}; run pnpm db:seed:platform first`,
		);
		process.exit(1);
	}
	ok("platform admin logged in");
	const platformBody = (await platformLogin.json()) as { accessToken?: string };
	if (!platformBody.accessToken) {
		fail("platform admin login", "missing access token");
		process.exit(1);
	}

	console.log("\nSection B. Platform APIs");
	const me = await get("/api/platform/me", platformBody.accessToken);
	expectStatus("GET /api/platform/me as platform admin", me.status, 200);

	const tenants = await get("/api/platform/tenants", platformBody.accessToken);
	expectStatus("GET /api/platform/tenants as platform admin", tenants.status, 200);
	if (tenants.status === 200) {
		const body = (await tenants.json()) as {
			tenants?: Array<{ id?: string; slug?: string; counts?: unknown }>;
		};
		if (Array.isArray(body.tenants) && body.tenants.some((t) => t.slug === "acme")) {
			ok("tenant list includes seeded acme tenant");
		} else {
			fail("tenant list shape", "expected tenants[] including acme");
		}
	}

	console.log("\nSection C. Signup boundaries");
	expectStatus(
		"GET /api/signup/request is not allowed",
		(await fetch(`${BASE}/api/signup/request`)).status,
		405,
	);

	const signup = await postJson("/api/signup/request", {
		tenantSlug: SIGNUP_SLUG,
		tenantName: "Verifier Tenant",
		adminName: "Verifier Admin",
		adminEmail: `${SIGNUP_SLUG}@example.test`,
		adminPassword: "Passw0rd!",
	});
	expectStatus("POST /api/signup/request", signup.status, 200);
	if (signup.status === 200) {
		const body = (await signup.json()) as {
			ok?: boolean;
			email?: string;
			expiresAt?: string;
			emailDeliveryConfigured?: boolean;
			verificationUrl?: string;
		};
		if (body.ok && body.email && body.expiresAt) {
			ok("signup request returns verification metadata");
		} else {
			fail("signup request shape", "expected ok/email/expiresAt");
		}
	}

	console.log(`\n${passed} passed, ${failed} failed (${BASE})`);
	if (failed > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
