import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { collections as collectionsTable } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, forbidden, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * Phase 8 - Step 2 of the upload pipeline.
 *
 * After the device PUTs the photo / signature bytes to R2 via the
 * presigned URL, it calls this endpoint with the storage keys it just
 * wrote so the server can persist them on the collection row. We
 * deliberately accept *keys* (not full URLs) so the client cannot inject
 * arbitrary external links; the receipt route always re-presigns from
 * the key at render time.
 *
 *   PATCH /api/collections/{id}/attachments
 *   { photoUrl?: string, signatureUrl?: string }
 *
 * Both fields are optional so the device can send whichever pair it has
 * - a cash collection might capture only a signature and skip the photo.
 */
const Body = z
	.object({
		photoUrl: z
			.string()
			.trim()
			.min(1)
			.max(500)
			.regex(/^t\/[\w-]+\/photos\/[\w-]+\.(jpe?g|png|webp)$/i, {
				message:
					"photoUrl must be a tenant-prefixed photo key (t/{slug}/photos/...)",
			})
			.optional(),
		signatureUrl: z
			.string()
			.trim()
			.min(1)
			.max(500)
			.regex(/^t\/[\w-]+\/signatures\/[\w-]+\.(png|webp|jpe?g)$/i, {
				message:
					"signatureUrl must be a tenant-prefixed signature key (t/{slug}/signatures/...)",
			})
			.optional(),
	})
	.refine((v) => v.photoUrl || v.signatureUrl, {
		message: "At least one of photoUrl or signatureUrl is required",
	});

export async function PATCH(
	req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "agent", "manager", "super_admin");
		const { id } = await ctx.params;

		const parsed = Body.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) {
			throw badRequest("Invalid body", parsed.error.flatten());
		}

		const result = await withTenant(auth.tid, async (tx) => {
			const [existing] = await tx
				.select({
					id: collectionsTable.id,
					agentId: collectionsTable.agentId,
					photoUrl: collectionsTable.photoUrl,
					signatureUrl: collectionsTable.signatureUrl,
				})
				.from(collectionsTable)
				.where(eq(collectionsTable.id, id))
				.limit(1);
			if (!existing) throw notFound("Collection not found");
			if (auth.role === "agent" && existing.agentId !== auth.sub) {
				throw forbidden("This collection is not yours");
			}

			// Idempotent: ignore writes that match what's already on the row.
			const next = {
				photoUrl: parsed.data.photoUrl ?? existing.photoUrl,
				signatureUrl: parsed.data.signatureUrl ?? existing.signatureUrl,
			};
			if (
				next.photoUrl === existing.photoUrl &&
				next.signatureUrl === existing.signatureUrl
			) {
				return existing;
			}

			const [updated] = await tx
				.update(collectionsTable)
				.set(next)
				.where(eq(collectionsTable.id, id))
				.returning({
					id: collectionsTable.id,
					photoUrl: collectionsTable.photoUrl,
					signatureUrl: collectionsTable.signatureUrl,
				});

			await appendAudit(tx, {
				tenantId: auth.tid,
				actorId: auth.sub,
				action: "collection.attached",
				entityType: "collection",
				entityId: existing.id,
				before: {
					photoUrl: existing.photoUrl,
					signatureUrl: existing.signatureUrl,
				},
				after: next,
			});

			return updated;
		});

		return NextResponse.json({
			collection: {
				id: result.id,
				photoUrl: result.photoUrl,
				signatureUrl: result.signatureUrl,
			},
		});
	} catch (err) {
		return toResponse(err);
	}
}
