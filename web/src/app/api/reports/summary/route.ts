import { and, asc, between, eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { collections, users } from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const Query = z.object({
	from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
	to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

/**
 * Phase 9 - aggregated KPIs and per-day / per-agent buckets for the
 * Reports page. We compute everything in SQL so a tenant with thousands
 * of collections still renders instantly.
 *
 *   GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns:
 *   - byDay:  [{ day, count, amount }]      bucketed in UTC
 *   - byAgent:[{ agentId, agentName, count, amount }]
 *   - byMode: [{ mode, count, amount }]
 *   - totals: { count, amount, supervisorReview }
 */
export async function GET(req: NextRequest) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin", "manager", "auditor");

		const url = new URL(req.url);
		const parsed = Query.safeParse({
			from: url.searchParams.get("from"),
			to: url.searchParams.get("to"),
		});
		if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
		const startUtc = new Date(`${parsed.data.from}T00:00:00.000Z`);
		const endUtc = new Date(`${parsed.data.to}T23:59:59.999Z`);

		const data = await withTenant(auth.tid, async (tx) => {
			const totals = await tx
				.select({
					count: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
					supervisorReview: sql<number>`sum(case when ${collections.supervisorReview} then 1 else 0 end)::int`,
				})
				.from(collections)
				.where(between(collections.collectedAt, startUtc, endUtc));

			const byDay = await tx
				.select({
					day: sql<string>`to_char(${collections.collectedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
					count: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
				})
				.from(collections)
				.where(between(collections.collectedAt, startUtc, endUtc))
				.groupBy(sql`to_char(${collections.collectedAt} at time zone 'UTC', 'YYYY-MM-DD')`)
				.orderBy(
					asc(sql`to_char(${collections.collectedAt} at time zone 'UTC', 'YYYY-MM-DD')`),
				);

			const byAgentRaw = await tx
				.select({
					agentId: collections.agentId,
					count: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
				})
				.from(collections)
				.where(between(collections.collectedAt, startUtc, endUtc))
				.groupBy(collections.agentId);

			const byMode = await tx
				.select({
					mode: collections.paymentMode,
					count: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
				})
				.from(collections)
				.where(between(collections.collectedAt, startUtc, endUtc))
				.groupBy(collections.paymentMode);

			return { totals: totals[0], byDay, byAgentRaw, byMode };
		});

		// Resolve agent names from the auth-only `users` table.
		const agentIds = data.byAgentRaw.map((a) => a.agentId);
		const agentMap = new Map<
			string,
			{ name: string | null; agentCode: string | null }
		>();
		if (agentIds.length > 0) {
			await withoutTenant(async (tx) => {
				const rows = await tx
					.select({
						id: users.id,
						name: users.name,
						agentCode: users.agentCode,
					})
					.from(users)
					.where(and(eq(users.tenantId, auth.tid)));
				for (const r of rows) {
					agentMap.set(r.id, { name: r.name, agentCode: r.agentCode });
				}
			});
		}

		const byAgent = data.byAgentRaw
			.map((a) => ({
				agentId: a.agentId,
				agentName: agentMap.get(a.agentId)?.name ?? "Unknown",
				agentCode: agentMap.get(a.agentId)?.agentCode ?? null,
				count: a.count,
				amount: a.amount,
			}))
			.sort((a, b) => b.amount - a.amount);

		return NextResponse.json({
			window: {
				from: parsed.data.from,
				to: parsed.data.to,
			},
			totals: data.totals,
			byDay: data.byDay,
			byAgent,
			byMode: data.byMode,
		});
	} catch (err) {
		return toResponse(err);
	}
}
