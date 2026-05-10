import { desc, eq, isNotNull, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
	collections,
	customers,
	supervisorReviews,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const Query = z.object({
	status: z.enum(["pending", "resolved", "all"]).default("pending"),
});

/**
 * Phase 9 - supervisor review queue. Lists all rows in `supervisor_reviews`
 * for the current tenant, joined with the underlying collection, customer,
 * and the agent who recorded it. Resolved rows are included so reviewers
 * can audit prior decisions, but the query defaults to "pending only".
 *
 * Filters via `?status=pending|resolved|all`.
 */
export async function GET(req: NextRequest) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin", "manager", "auditor");

		const url = new URL(req.url);
		const parsed = Query.safeParse({
			status: url.searchParams.get("status") ?? undefined,
		});
		if (!parsed.success) {
			throw badRequest("Invalid query", parsed.error.flatten());
		}
		const { status } = parsed.data;

		const filtered = await withTenant(auth.tid, async (tx) => {
			const where =
				status === "pending"
					? isNull(supervisorReviews.resolvedAt)
					: status === "resolved"
						? isNotNull(supervisorReviews.resolvedAt)
						: undefined;

			return tx
				.select({
					id: supervisorReviews.id,
					reason: supervisorReviews.reason,
					payload: supervisorReviews.payload,
					createdAt: supervisorReviews.createdAt,
					resolvedAt: supervisorReviews.resolvedAt,
					resolvedBy: supervisorReviews.resolvedBy,
					collectionId: supervisorReviews.collectionId,
					receiptNo: collections.receiptNo,
					amount: collections.amount,
					customerId: collections.customerId,
					customerName: customers.name,
					customerCode: customers.code,
					agentId: collections.agentId,
					collectedAt: collections.collectedAt,
				})
				.from(supervisorReviews)
				.leftJoin(collections, eq(collections.id, supervisorReviews.collectionId))
				.leftJoin(customers, eq(customers.id, collections.customerId))
				.where(where)
				.orderBy(desc(supervisorReviews.createdAt))
				.limit(500);
		});

		// Resolve agent names without RLS - users live in the auth-only table.
		const agentIds = Array.from(
			new Set(filtered.map((r) => r.agentId).filter(Boolean) as string[]),
		);
		const agentMap = new Map<
			string,
			{ id: string; name: string | null; agentCode: string | null }
		>();
		if (agentIds.length > 0) {
			await withoutTenant(async (tx) => {
				const agents = await tx
					.select({
						id: users.id,
						name: users.name,
						agentCode: users.agentCode,
					})
					.from(users)
					.where(eq(users.tenantId, auth.tid));
				for (const a of agents) {
					agentMap.set(a.id, a);
				}
			});
		}

		const enriched = filtered.map((r) => ({
			...r,
			agent:
				r.agentId && agentMap.has(r.agentId)
					? {
							id: r.agentId,
							name: agentMap.get(r.agentId)?.name ?? null,
							agentCode: agentMap.get(r.agentId)?.agentCode ?? null,
						}
					: null,
		}));

		return NextResponse.json({ reviews: enriched });
	} catch (err) {
		return toResponse(err);
	}
}
