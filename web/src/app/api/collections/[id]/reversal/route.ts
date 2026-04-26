import { eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
	collectionReversals,
	collections as collectionsTable,
	customers,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, HttpError, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const Body = z.object({
	reason: z.string().min(3).max(500),
});

function clientIp(req: NextRequest): string | null {
	return (
		req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		req.headers.get("x-real-ip") ??
		null
	);
}

export async function POST(
	req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		// Reversals are a financial action - never let an agent self-reverse.
		requireRole(auth, "manager", "super_admin");

		const { id } = await ctx.params;
		const parsed = Body.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());

		const result = await withTenant(auth.tid, async (tx) => {
			const [orig] = await tx
				.select()
				.from(collectionsTable)
				.where(eq(collectionsTable.id, id))
				.limit(1);
			if (!orig) throw notFound("Collection not found");

			// Refuse double-reversal: any reversal row makes the original
			// already-reversed (we keep the simple "one reversal per collection"
			// invariant in Phase 3; multi-step adjustments come later).
			const existing = await tx
				.select({ id: collectionReversals.id })
				.from(collectionReversals)
				.where(eq(collectionReversals.originalCollectionId, id))
				.limit(1);
			if (existing[0]) {
				throw new HttpError(
					409,
					"already_reversed",
					"This collection has already been reversed.",
				);
			}

			const [reversal] = await tx
				.insert(collectionReversals)
				.values({
					tenantId: auth.tid,
					originalCollectionId: orig.id,
					amount: orig.amount,
					reason: parsed.data.reason,
					authorisedBy: auth.sub,
				})
				.returning();

			// Restore the customer's outstanding balance. We store these as
			// floats; if we ever move to numeric() the same SQL works.
			await tx
				.update(customers)
				.set({
					outstandingBalance: sql`${customers.outstandingBalance} + ${orig.amount}`,
					updatedAt: new Date(),
				})
				.where(eq(customers.id, orig.customerId));

			await appendAudit(tx, {
				tenantId: auth.tid,
				actorId: auth.sub,
				action: "collection.reverse",
				entityType: "collection",
				entityId: orig.id,
				before: {
					receiptNo: orig.receiptNo,
					amount: orig.amount,
					customerId: orig.customerId,
				},
				after: {
					reversalId: reversal.id,
					reason: parsed.data.reason,
				},
				ip: clientIp(req),
				deviceId: null,
				userAgent: req.headers.get("user-agent"),
			});

			return reversal;
		});

		return NextResponse.json({ reversal: result }, { status: 201 });
	} catch (err) {
		return toResponse(err);
	}
}
