import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { collections, supervisorReviews } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const PatchBody = z.object({
	action: z.enum(["resolve", "reopen"]),
	note: z.string().trim().max(2000).optional(),
});

/**
 * Phase 9 - resolve or reopen a single supervisor review row.
 *
 * Resolving:
 *   - stamps `resolved_at` + `resolved_by`
 *   - clears `collections.supervisor_review` if no other open reviews
 *     reference the same collection
 *
 * Reopening clears `resolved_at` + `resolved_by` and re-flags the
 * collection. Both actions append an `review.<action>` audit event.
 */
export async function PATCH(
	req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin", "manager");
		const { id } = await ctx.params;

		const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const { action, note } = parsed.data;

		const result = await withTenant(auth.tid, async (tx) => {
			const [existing] = await tx
				.select()
				.from(supervisorReviews)
				.where(eq(supervisorReviews.id, id))
				.limit(1);
			if (!existing) throw notFound("Review not found");

			const nowIso = new Date();
			const next =
				action === "resolve"
					? { resolvedAt: nowIso, resolvedBy: auth.sub }
					: { resolvedAt: null, resolvedBy: null };

			const [updated] = await tx
				.update(supervisorReviews)
				.set(next)
				.where(eq(supervisorReviews.id, id))
				.returning();

			// Sync the parent collection's flag. We re-derive from "any open
			// reviews remain?" so a separate review doesn't get stomped.
			const remainingOpen = await tx
				.select({ id: supervisorReviews.id })
				.from(supervisorReviews)
				.where(eq(supervisorReviews.collectionId, existing.collectionId));
			const stillOpen = remainingOpen.some((r) => {
				if (r.id === id) {
					return action === "reopen";
				}
				return true;
			});

			await tx
				.update(collections)
				.set({ supervisorReview: stillOpen })
				.where(eq(collections.id, existing.collectionId));

			await appendAudit(tx, {
				tenantId: auth.tid,
				actorId: auth.sub,
				action: action === "resolve" ? "review.resolve" : "review.reopen",
				entityType: "supervisor_review",
				entityId: id,
				before: { resolvedAt: existing.resolvedAt, resolvedBy: existing.resolvedBy },
				after: { resolvedAt: updated.resolvedAt, resolvedBy: updated.resolvedBy, note },
			});

			return updated;
		});

		return NextResponse.json({ review: result });
	} catch (err) {
		return toResponse(err);
	}
}
