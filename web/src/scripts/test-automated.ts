/**
 * VCTS automated regression runner.
 *
 * Default mode is safe for local development and CI:
 *   - pure unit-style assertions for shared helpers
 *   - TypeScript check
 *   - ESLint
 *
 * Optional flags:
 *   --unit-only   only run the in-process assertions
 *   --build       also run `next build`
 *   --http        also run deployed HTTP verifiers (`verify:isolation`, `verify:platform`)
 *   --all         equivalent to `--build --http`
 *
 * Examples:
 *   pnpm test:automated
 *   pnpm test:automated -- --build
 *   VCTS_BASE_URL=https://project-jcsyq.vercel.app pnpm test:automated -- --http
 */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

import { readBranding, legalNameFor } from "@/lib/tenants/branding";
import { readGeofenceSettings, readSyncSettings } from "@/lib/tenants/settings";

const args = new Set(process.argv.slice(2));
const unitOnly = args.has("--unit-only");
const runBuild = args.has("--build") || args.has("--all");
const runHttp = args.has("--http") || args.has("--all");

function section(name: string) {
	console.log(`\n=== ${name} ===`);
}

function run(label: string, commandArgs: string[]) {
	console.log(`\n$ pnpm ${commandArgs.join(" ")}`);
	const res = spawnSync(`pnpm ${commandArgs.join(" ")}`, {
		stdio: "inherit",
		shell: true,
		env: process.env,
	});
	if (res.status !== 0) {
		const detail =
			res.status === null && res.error ? `: ${res.error.message}` : "";
		throw new Error(
			`${label} failed with exit code ${res.status ?? "unknown"}${detail}`,
		);
	}
}

function runUnitAssertions() {
	section("Unit assertions");

	assert.deepEqual(readBranding(null), {});
	assert.deepEqual(readBranding({ branding: { legalName: "Acme Pvt Ltd" } }), {
		legalName: "Acme Pvt Ltd",
	});
	assert.equal(
		legalNameFor({ branding: { legalName: "Legal Co" } }, "Fallback Co"),
		"Legal Co",
	);
	assert.equal(legalNameFor({ branding: {} }, "Fallback Co"), "Fallback Co");

	assert.deepEqual(readGeofenceSettings(null), {
		defaultRadiusM: 100,
		minAccuracyM: 50,
	});
	assert.deepEqual(
		readGeofenceSettings({
			geofence: { defaultRadiusM: "150", minAccuracyM: "25" },
		}),
		{ defaultRadiusM: 150, minAccuracyM: 25 },
	);
	assert.deepEqual(
		readGeofenceSettings({
			geofence: { defaultRadiusM: 10, minAccuracyM: 1 },
		}),
		{ defaultRadiusM: 100, minAccuracyM: 50 },
	);

	assert.deepEqual(readSyncSettings(null), { intervalMin: 15 });
	assert.deepEqual(readSyncSettings({ sync: { intervalMin: "30" } }), {
		intervalMin: 30,
	});
	assert.deepEqual(readSyncSettings({ sync: { intervalMin: 999 } }), {
		intervalMin: 15,
	});

	console.log("Unit assertions passed");
}

async function main() {
	runUnitAssertions();
	if (unitOnly) return;

	section("Static checks");
	run("TypeScript", ["tsc", "--noEmit"]);
	run("ESLint", ["lint", "--quiet"]);

	if (runBuild) {
		section("Production build");
		run("Next build", ["next", "build"]);
	}

	if (runHttp) {
		section("HTTP verifiers");
		if (!process.env.VCTS_BASE_URL) {
			console.warn(
				"VCTS_BASE_URL is unset; verifiers will use their script defaults.",
			);
		}
		run("tenant/role isolation verifier", ["verify:isolation"]);
		run("platform verifier", ["verify:platform"]);
	}

	console.log("\nAutomated test run passed");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
