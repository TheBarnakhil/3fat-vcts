import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
	collections as collectionsTable,
	tenants,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import {
	badRequest,
	forbidden,
	notFound,
	serverError,
	tooMany,
	toResponse,
} from "@/lib/errors";
import { limitAttachments, rateLimitHeaders } from "@/lib/rate-limit";
import {
	photoKey as buildPhotoKey,
	presignPutUrl,
	r2Enabled,
	signatureKey as buildSignatureKey,
} from "@/lib/storage/r2";

export const runtime = "nodejs";

const Body = z.object({
	kind: z.enum(["photo", "signature"]),
	contentType: z
		.string()
		.trim()
		.min(1)
		.max(80)
		.regex(/^image\/(jpe?g|png|webp)$/i, {
			message: "Only JPEG / PNG / WebP image content types are accepted",
		}),
});

/**
 * Phase 8 - Step 1 of the upload pipeline.
 *
 * The agent device asks the server for a tenant-prefixed presigned PUT URL.
 * The bytes never flow through this Next.js route - keeps Vercel function
 * payloads tiny and side-steps the 4.5 MB request body limit.
 *
 *   POST /api/collections/{id}/attachments/presign
 *   { kind: "photo" | "signature", contentType: "image/jpeg" }
 *
 * Once the client PUTs the bytes to the returned URL, it calls
 * `PATCH /api/collections/{id}/attachments` to persist the resulting
 * `photo_url` / `signature_url` on the collection row.
 */
export async function POST(
	req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "agent", "manager", "super_admin");

		// Throttle per (tenant, user) so a runaway client can't spam the
		// presign endpoint and exhaust our R2 sign-budget.
		const rl = await limitAttachments(auth.tid, auth.sub);
		const rlHeaders = rateLimitHeaders(rl);
		if (!rl.success) {
			const err = tooMany("Too many attachment requests. Try again shortly.");
			return NextResponse.json(
				{ error: { code: err.code, message: err.message } },
				{ status: err.status, headers: rlHeaders },
			);
		}

		const { id } = await ctx.params;
		const parsed = Body.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) {
			throw badRequest("Invalid body", parsed.error.flatten());
		}
		const { kind, contentType } = parsed.data;

		if (!r2Enabled()) {
			// Server is not wired to R2 - either still local-dev or a misconfig.
			// We deliberately fail rather than no-op so the device knows the
			// attachment cannot be uploaded for *this* deploy.
			throw serverError(
				"Object storage is not configured on the server. Attachments are temporarily disabled.",
			);
		}

		// Confirm the collection exists in this tenant + the agent owns it.
		const [collection] = await withTenant(auth.tid, async (tx) =>
			tx
				.select({
					id: collectionsTable.id,
					agentId: collectionsTable.agentId,
				})
				.from(collectionsTable)
				.where(
					and(
						eq(collectionsTable.id, id),
						eq(collectionsTable.tenantId, auth.tid),
					),
				)
				.limit(1),
		);
		if (!collection) throw notFound("Collection not found");
		if (auth.role === "agent" && collection.agentId !== auth.sub) {
			// Cross-tenant attempts never reach here (the lookup above is
			// tenantId-filtered), so this branch is exclusively same-tenant
			// cross-agent and 403 is the right signal.
			throw forbidden("This collection is not yours");
		}

		// Tenant slug is needed for the bucket prefix. Tenants table has no RLS
		// (it's the root of multi-tenancy itself) so we resolve through the
		// auth-only path.
		const [tenantRow] = await withoutTenant(async (tx) =>
			tx
				.select({ slug: tenants.slug })
				.from(tenants)
				.where(and(eq(tenants.id, auth.tid)))
				.limit(1),
		);
		if (!tenantRow) throw notFound("Tenant not found");

		const key =
			kind === "photo"
				? buildPhotoKey(tenantRow.slug, collection.id)
				: buildSignatureKey(tenantRow.slug, collection.id);

		const url = await presignPutUrl(key, contentType);

		return NextResponse.json(
			{
				url,
				key,
				method: "PUT",
				headers: { "Content-Type": contentType },
			},
			{ headers: rlHeaders },
		);
	} catch (err) {
		return toResponse(err);
	}
}
