import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { unauthorized, toResponse } from "@/lib/errors";
import {
	DEFAULT_RECOMPUTE_CONFIG,
	recomputeAllTenants,
} from "@/lib/visits/recompute";

export const runtime = "nodejs";

/**
 * `GET|POST /api/cron/visits/recompute`
 *
 * Vercel Cron entry point that re-derives `customer_visits` rows from
 * recent `location_logs` and raises `unverified_visit` supervisor reviews
 * for collections whose GPS isn't backed by tracker presence.
 *
 * Authentication:
 *   - Vercel Cron forwards `Authorization: Bearer <CRON_SECRET>` to the
 *     URL configured in `vercel.json`. We compare against `env.CRON_SECRET`.
 *   - Local invocation works without a secret in dev (so the verify script
 *     can hit it) but is rejected in production whenever `CRON_SECRET`
 *     is configured.
 *
 * Both GET and POST are accepted because Vercel Cron uses GET; humans /
 * scripts may prefer POST. Either way is idempotent.
 */
async function runRecompute() {
	try {
		const h = await headers();
		const secret = env.CRON_SECRET;
		if (secret) {
			const auth = h.get("authorization") ?? "";
			if (!auth.toLowerCase().startsWith("bearer ")) throw unauthorized();
			const provided = auth.slice(7).trim();
			if (provided !== secret) {
				throw unauthorized("Invalid cron secret");
			}
		} else if (env.NODE_ENV === "production") {
			throw unauthorized("CRON_SECRET is not configured in production");
		}

		const stats = await recomputeAllTenants(DEFAULT_RECOMPUTE_CONFIG);
		return NextResponse.json(stats);
	} catch (err) {
		return toResponse(err);
	}
}

export async function GET() {
	return runRecompute();
}

export async function POST() {
	return runRecompute();
}
