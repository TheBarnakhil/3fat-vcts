import { and, asc, between, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
	collections as collectionsTable,
	customerVisits,
	locationLogs,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * Hard cap so a managers-on-vacation lookup at 100,000-fix granularity
 * doesn't melt the lambda. A 24h window at 5min interval is 288 fixes per
 * agent; the cap is generous.
 */
const MAX_FIXES = 5000;

const Query = z.object({
	day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
	tz: z.string().min(2).max(64).optional(),
});

/**
 * `GET /api/agents/:id/movement?day=YYYY-MM-DD[&tz=Asia/Kolkata]`
 *
 * Manager / super-admin / auditor surface for replaying a single agent's
 * day. Returns:
 *   - All `location_logs` for the day, ordered by `logged_at`.
 *   - All `customer_visits` derived for that day so the manager can see
 *     which fixes coalesced into a "real" visit.
 *
 * Day boundaries are computed in the optional `tz` (defaulting to UTC).
 * The web replay (Phase 9) will pass the manager's local timezone here.
 *
 * Agents are never allowed - they get their own movement implicitly by
 * having recorded it in the first place.
 */
export async function GET(
	req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin", "manager", "auditor");
		const { id: agentId } = await ctx.params;

		const url = new URL(req.url);
		const parsed = Query.safeParse({
			day: url.searchParams.get("day") ?? undefined,
			tz: url.searchParams.get("tz") ?? undefined,
		});
		if (!parsed.success) {
			throw badRequest("Invalid query", parsed.error.flatten());
		}
		const { day, tz } = parsed.data;

		// Verify the agent belongs to the manager's tenant. `users` is the
		// auth-only table (no vcts_app grants), so check via withoutTenant
		// but explicitly restrict by tid.
		const [agent] = await withoutTenant(async (tx) =>
			tx
				.select({
					id: users.id,
					name: users.name,
					email: users.email,
					agentCode: users.agentCode,
				})
				.from(users)
				.where(and(eq(users.id, agentId), eq(users.tenantId, auth.tid)))
				.limit(1),
		);
		if (!agent) throw notFound("Agent not found in this tenant");

		const { startUtc, endUtc } = dayBoundsToUtc(day, tz);

		const data = await withTenant(auth.tid, async (tx) => {
			const fixes = await tx
				.select({
					id: locationLogs.id,
					lat: locationLogs.lat,
					lng: locationLogs.lng,
					accuracyM: locationLogs.accuracyM,
					batteryPct: locationLogs.batteryPct,
					source: locationLogs.source,
					loggedAt: locationLogs.loggedAt,
				})
				.from(locationLogs)
				.where(
					and(
						eq(locationLogs.agentId, agentId),
						between(locationLogs.loggedAt, startUtc, endUtc),
					),
				)
				.orderBy(asc(locationLogs.loggedAt))
				.limit(MAX_FIXES);

			const visits = await tx
				.select()
				.from(customerVisits)
				.where(
					and(
						eq(customerVisits.agentId, agentId),
						between(customerVisits.startedAt, startUtc, endUtc),
					),
				)
				.orderBy(asc(customerVisits.startedAt));

			const collections = await tx
				.select({
					id: collectionsTable.id,
					receiptNo: collectionsTable.receiptNo,
					customerId: collectionsTable.customerId,
					amount: collectionsTable.amount,
					paymentMode: collectionsTable.paymentMode,
					collectedAt: collectionsTable.collectedAt,
					supervisorReview: collectionsTable.supervisorReview,
				})
				.from(collectionsTable)
				.where(
					and(
						eq(collectionsTable.agentId, agentId),
						between(collectionsTable.collectedAt, startUtc, endUtc),
					),
				)
				.orderBy(asc(collectionsTable.collectedAt));

			return { fixes, visits, collections };
		});

		return NextResponse.json({
			agent: {
				id: agent.id,
				name: agent.name,
				email: agent.email,
				agentCode: agent.agentCode,
			},
			window: {
				day,
				tz: tz ?? "UTC",
				startUtc: startUtc.toISOString(),
				endUtc: endUtc.toISOString(),
			},
			fixes: data.fixes,
			visits: data.visits,
			collections: data.collections,
			truncated: data.fixes.length === MAX_FIXES,
		});
	} catch (err) {
		return toResponse(err);
	}
}

/**
 * Convert a YYYY-MM-DD + IANA timezone to an inclusive [start, end] UTC
 * pair representing midnight to next-midnight in that timezone.
 *
 * We avoid third-party timezone deps by using `Intl.DateTimeFormat` to
 * compute the offset for the requested instant. Falls back to UTC when
 * `tz` is omitted or invalid so callers still get a sensible response.
 */
function dayBoundsToUtc(day: string, tz?: string): { startUtc: Date; endUtc: Date } {
	if (!tz) {
		const startUtc = new Date(`${day}T00:00:00.000Z`);
		const endUtc = new Date(`${day}T23:59:59.999Z`);
		return { startUtc, endUtc };
	}
	try {
		const start = zonedDayStartToUtc(day, tz);
		const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
		return { startUtc: start, endUtc: end };
	} catch {
		const startUtc = new Date(`${day}T00:00:00.000Z`);
		const endUtc = new Date(`${day}T23:59:59.999Z`);
		return { startUtc, endUtc };
	}
}

function zonedDayStartToUtc(day: string, tz: string): Date {
	// Start with a guess: midnight UTC of that day. Compute what hour:minute
	// that instant *renders as* in the target tz, then adjust by the diff.
	// One adjustment is enough for any zone with stable UTC offsets; for DST
	// transition dates Postgres does the right thing internally because the
	// server stores everything in UTC.
	const guess = new Date(`${day}T00:00:00.000Z`);
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = fmt.formatToParts(guess);
	const get = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? "0");
	const renderedAsUtc = Date.UTC(
		get("year"),
		get("month") - 1,
		get("day"),
		get("hour") === 24 ? 0 : get("hour"),
		get("minute"),
		get("second"),
	);
	const offsetMs = guess.getTime() - renderedAsUtc;
	return new Date(guess.getTime() + offsetMs);
}
