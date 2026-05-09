import { and, desc, eq, lt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { auditTrail, users } from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

/**
 * Phase 9 - paginated read of the tenant's HMAC-chained audit trail.
 *
 *   GET /api/audit?cursor=<seq>&limit=<n>&action=<filter>
 *
 * Cursor-based pagination on `seq DESC`. The cursor is the `seq` of the
 * last row returned in the previous page. We don't surface row HMACs
 * over the API (the verify endpoint is the only place that recomputes
 * them) so a malicious admin can't reconstruct the chain offline.
 */
export async function GET(req: NextRequest) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin", "manager", "auditor");

		const url = new URL(req.url);
		const cursor = url.searchParams.get("cursor");
		const limitRaw = url.searchParams.get("limit");
		const actionFilter = url.searchParams.get("action")?.trim().toLowerCase();
		const limit = Math.min(
			MAX_PAGE_SIZE,
			Math.max(1, Number(limitRaw) || PAGE_SIZE),
		);

		const where = and(
			eq(auditTrail.tenantId, auth.tid),
			cursor ? lt(auditTrail.seq, Number(cursor)) : undefined,
			actionFilter ? eq(auditTrail.action, actionFilter) : undefined,
		);

		const rows = await withTenant(auth.tid, async (tx) =>
			tx
				.select({
					id: auditTrail.id,
					seq: auditTrail.seq,
					actorId: auditTrail.actorId,
					action: auditTrail.action,
					entityType: auditTrail.entityType,
					entityId: auditTrail.entityId,
					beforeJson: auditTrail.beforeJson,
					afterJson: auditTrail.afterJson,
					ip: auditTrail.ip,
					createdAt: auditTrail.createdAt,
				})
				.from(auditTrail)
				.where(where)
				.orderBy(desc(auditTrail.seq))
				.limit(limit),
		);

		// Resolve actor names from auth-only `users` table.
		const actorIds = Array.from(
			new Set(rows.map((r) => r.actorId).filter(Boolean) as string[]),
		);
		const actorMap = new Map<
			string,
			{ name: string | null; email: string; agentCode: string | null }
		>();
		if (actorIds.length > 0) {
			await withoutTenant(async (tx) => {
				const actors = await tx
					.select({
						id: users.id,
						name: users.name,
						email: users.email,
						agentCode: users.agentCode,
					})
					.from(users)
					.where(eq(users.tenantId, auth.tid));
				for (const a of actors) actorMap.set(a.id, a);
			});
		}

		const enriched = rows.map((r) => ({
			...r,
			actor: r.actorId
				? {
						id: r.actorId,
						name: actorMap.get(r.actorId)?.name ?? null,
						email: actorMap.get(r.actorId)?.email ?? null,
						agentCode: actorMap.get(r.actorId)?.agentCode ?? null,
					}
				: null,
		}));

		const nextCursor =
			enriched.length === limit ? enriched[enriched.length - 1].seq : null;

		return NextResponse.json({ rows: enriched, nextCursor });
	} catch (err) {
		return toResponse(err);
	}
}
