import { and, asc, between, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
	collections,
	customers,
	customerVisits,
	locationLogs,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

function startOfUtcDay(d = new Date()): Date {
	const day = new Date(d);
	day.setUTCHours(0, 0, 0, 0);
	return day;
}

function addDays(d: Date, days: number): Date {
	const next = new Date(d);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export async function GET() {
	try {
		const auth = await requireAuth();
		const now = new Date();
		const todayStart = startOfUtcDay(now);
		const todayEnd = addDays(todayStart, 1);
		const yesterdayStart = addDays(todayStart, -1);
		const last7Start = addDays(todayStart, -6);
		const agentScoped = auth.role === "agent";

		const data = await withTenant(auth.tid, async (tx) => {
			// Defense in depth: every aggregation includes the tenantId predicate
			// so a misconfigured RLS policy cannot leak cross-tenant rows into a
			// dashboard sum.
			const collectionTenant = eq(collections.tenantId, auth.tid);
			const visitTenant = eq(customerVisits.tenantId, auth.tid);
			const locationTenant = eq(locationLogs.tenantId, auth.tid);
			const collectionScope = agentScoped
				? and(collectionTenant, eq(collections.agentId, auth.sub))
				: collectionTenant;
			const visitScope = agentScoped
				? and(visitTenant, eq(customerVisits.agentId, auth.sub))
				: visitTenant;
			const locationScope = agentScoped
				? and(locationTenant, eq(locationLogs.agentId, auth.sub))
				: locationTenant;

			const [today] = await tx
				.select({
					count: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
					flagged: sql<number>`sum(case when ${collections.supervisorReview} then 1 else 0 end)::int`,
				})
				.from(collections)
				.where(
					and(
						between(collections.collectedAt, todayStart, todayEnd),
						collectionScope,
					),
				);

			const [yesterday] = await tx
				.select({
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
				})
				.from(collections)
				.where(
					and(
						between(collections.collectedAt, yesterdayStart, todayStart),
						collectionScope,
					),
				);

			const [last7] = await tx
				.select({
					receipts: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
				})
				.from(collections)
				.where(and(gte(collections.collectedAt, last7Start), collectionScope));

			const [visitStats] = await tx
				.select({
					visits: sql<number>`count(*)::int`,
					withCollection: sql<number>`count(${customerVisits.collectionId})::int`,
				})
				.from(customerVisits)
				.where(
					and(
						between(customerVisits.startedAt, todayStart, todayEnd),
						visitScope,
					),
				);

			const activeFromFixes = await tx
				.select({ agentId: locationLogs.agentId })
				.from(locationLogs)
				.where(and(gte(locationLogs.loggedAt, last7Start), locationScope))
				.groupBy(locationLogs.agentId);

			const activeFromCollections = await tx
				.select({ agentId: collections.agentId })
				.from(collections)
				.where(and(gte(collections.collectedAt, last7Start), collectionScope))
				.groupBy(collections.agentId);

			const trend = await tx
				.select({
					day: sql<string>`to_char(${collections.collectedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
					count: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
				})
				.from(collections)
				.where(and(gte(collections.collectedAt, last7Start), collectionScope))
				.groupBy(sql`to_char(${collections.collectedAt} at time zone 'UTC', 'YYYY-MM-DD')`)
				.orderBy(
					asc(sql`to_char(${collections.collectedAt} at time zone 'UTC', 'YYYY-MM-DD')`),
				);

			const topAgentsRaw = await tx
				.select({
					agentId: collections.agentId,
					count: sql<number>`count(*)::int`,
					amount: sql<number>`coalesce(sum(${collections.amount}), 0)::float8`,
				})
				.from(collections)
				.where(and(gte(collections.collectedAt, last7Start), collectionScope))
				.groupBy(collections.agentId)
				.orderBy(desc(sql`coalesce(sum(${collections.amount}), 0)::float8`))
				.limit(5);

			const recentCollections = await tx
				.select({
					id: collections.id,
					receiptNo: collections.receiptNo,
					amount: collections.amount,
					collectedAt: collections.collectedAt,
					paymentMode: collections.paymentMode,
					supervisorReview: collections.supervisorReview,
					customerName: customers.name,
					customerCode: customers.code,
				})
				.from(collections)
				.innerJoin(
					customers,
					and(
						eq(customers.id, collections.customerId),
						eq(customers.tenantId, auth.tid),
					),
				)
				.where(collectionScope)
				.orderBy(desc(collections.collectedAt))
				.limit(5);

			const flaggedOpen = await tx
				.select({ count: sql<number>`count(*)::int` })
				.from(customerVisits)
				.where(
					and(
						between(customerVisits.startedAt, todayStart, todayEnd),
						visitScope,
						isNotNull(customerVisits.collectionId),
					),
				);

			return {
				today: today ?? { count: 0, amount: 0, flagged: 0 },
				yesterday: yesterday ?? { amount: 0 },
				last7: last7 ?? { receipts: 0, amount: 0 },
				visitStats: visitStats ?? { visits: 0, withCollection: 0 },
				activeAgentIds: Array.from(
					new Set([
						...activeFromFixes.map((r) => r.agentId),
						...activeFromCollections.map((r) => r.agentId),
					]),
				),
				trend,
				topAgentsRaw,
				recentCollections,
				collectionVisitCount: flaggedOpen[0]?.count ?? 0,
			};
		});

		const agentIds = Array.from(
			new Set([
				...data.topAgentsRaw.map((a) => a.agentId),
				...data.activeAgentIds,
			]),
		);
		const agentMap = new Map<string, { name: string; agentCode: string | null }>();
		if (agentIds.length > 0) {
			const userRows = await withoutTenant((tx) =>
				tx
					.select({
						id: users.id,
						name: users.name,
						agentCode: users.agentCode,
					})
					.from(users)
					.where(and(eq(users.tenantId, auth.tid))),
			);
			for (const u of userRows) agentMap.set(u.id, u);
		}

		const trendByDay = new Map(data.trend.map((d) => [d.day, d]));
		const normalizedTrend = Array.from({ length: 7 }, (_, i) => {
			const day = isoDay(addDays(last7Start, i));
			return trendByDay.get(day) ?? { day, count: 0, amount: 0 };
		});

		const yesterdayAmount = data.yesterday.amount ?? 0;
		const amountDeltaPct =
			yesterdayAmount === 0
				? data.today.amount > 0
					? 100
					: 0
				: ((data.today.amount - yesterdayAmount) / yesterdayAmount) * 100;
		const visitCoveragePct =
			data.today.count === 0
				? 0
				: Math.round((data.collectionVisitCount / data.today.count) * 100);

		return NextResponse.json({
			window: {
				today: isoDay(todayStart),
				last7From: isoDay(last7Start),
				last7To: isoDay(todayStart),
			},
			kpis: {
				collectedToday: data.today.amount,
				collectionsToday: data.today.count,
				collectedTodayDeltaPct: Math.round(amountDeltaPct),
				activeAgents7d: data.activeAgentIds.length,
				receipts7d: data.last7.receipts,
				amount7d: data.last7.amount,
				visitsToday: data.visitStats.visits,
				collectionsWithVisitToday: data.collectionVisitCount,
				visitCoveragePct,
				flaggedToday: data.today.flagged,
			},
			trend: normalizedTrend,
			topAgents: data.topAgentsRaw.map((a) => ({
				agentId: a.agentId,
				agentName: agentMap.get(a.agentId)?.name ?? "Unknown",
				agentCode: agentMap.get(a.agentId)?.agentCode ?? null,
				count: a.count,
				amount: a.amount,
			})),
			recentCollections: data.recentCollections,
		});
	} catch (err) {
		return toResponse(err);
	}
}
