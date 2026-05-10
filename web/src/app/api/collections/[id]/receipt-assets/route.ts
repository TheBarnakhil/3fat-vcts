import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import {
	collectionReversals,
	collections as collectionsTable,
	tenants,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { forbidden, notFound, toResponse } from "@/lib/errors";
import { publicReceiptUrl } from "@/lib/receipts/public-url";
import { readBranding } from "@/lib/tenants/branding";
import { presignGetUrl } from "@/lib/storage/r2";

export const runtime = "nodejs";

/**
 * Phase 10 / Track C1.
 *
 * Bundles everything the Android renderer needs to ship a PDF that
 * matches the web template: tenant branding (legalName / address /
 * gstin / phone), the agent's display name + agentCode, the customer
 * meta block, the reversed flag, the public verification URL, and
 * presigned GET URLs for the optional photo / signature / logo. We
 * combine these here rather than make the device round-trip three
 * separate endpoints (`/api/me`, `/api/tenants/me`, three presign
 * calls) because the device renders on a sometimes-flaky connection
 * and the smaller the wire chatter the better.
 *
 * The presigned URLs expire after `RECEIPT_PRESIGN_TTL_SECONDS`
 * (default 15 min); the device fetches each one inline while
 * rendering and discards them as soon as the bytes land. The Maps
 * static-map thumbnail is intentionally NOT bundled here - the device
 * fetches it from `/api/maps/static` so we don't double the JSON
 * payload size on every receipt preview.
 */
export async function GET(
	_req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		const { id } = await ctx.params;

		const data = await withTenant(auth.tid, async (tx) => {
			const [row] = await tx
				.select({
					collection: collectionsTable,
				})
				.from(collectionsTable)
				.where(
					and(
						eq(collectionsTable.id, id),
						eq(collectionsTable.tenantId, auth.tid),
					),
				)
				.limit(1);
			if (!row) return null;

			const reversals = await tx
				.select({ id: collectionReversals.id })
				.from(collectionReversals)
				.where(
					and(
						eq(collectionReversals.originalCollectionId, id),
						eq(collectionReversals.tenantId, auth.tid),
					),
				)
				.limit(1);

			return { ...row, reversed: reversals.length > 0 };
		});

		if (!data) throw notFound("Collection not found");
		if (auth.role === "agent" && data.collection.agentId !== auth.sub) {
			throw forbidden("This collection is not yours");
		}

		const [meta] = await withoutTenant(async (tx) =>
			tx
				.select({
					tenant: tenants,
					agentName: users.name,
					agentCode: users.agentCode,
				})
				.from(tenants)
				.innerJoin(users, eq(users.tenantId, tenants.id))
				.where(
					and(
						eq(tenants.id, auth.tid),
						eq(users.id, data.collection.agentId),
					),
				)
				.limit(1),
		);
		if (!meta) throw notFound("Tenant or agent metadata missing");

		const branding = readBranding(meta.tenant.settings);

		const verifyUrl = data.collection.receiptNo
			? publicReceiptUrl({ receiptNo: data.collection.receiptNo })
			: null;

		// Presigned GETs are best-effort. R2 might not be configured
		// (dev env), or the agent might be requesting before the upload
		// drainer has finished pushing the bytes. Either way the renderer
		// falls back to local files / "Not captured" placeholders.
		const ttl = env.RECEIPT_PRESIGN_TTL_SECONDS;
		async function presignOptional(key: string | null | undefined) {
			if (!key) return null;
			try {
				const url = await presignGetUrl(key, ttl);
				return { url, expiresInSeconds: ttl };
			} catch {
				return null;
			}
		}

		const photoKey = data.collection.photoUrl ?? null;
		const signatureKey = data.collection.signatureUrl ?? null;
		const logoKeyOrUrl = branding.logoUrl ?? null;

		const [photo, signature, logo] = await Promise.all([
			presignOptional(photoKey),
			presignOptional(signatureKey),
			// Logo can be either an R2 key (`t/<slug>/branding/logo.png`)
			// or an absolute CDN URL. Only presign the former; pass the
			// latter through as-is.
			logoKeyOrUrl && logoKeyOrUrl.startsWith("t/")
				? presignOptional(logoKeyOrUrl)
				: Promise.resolve(
						logoKeyOrUrl
							? { url: logoKeyOrUrl, expiresInSeconds: 0 }
							: null,
					),
		]);

		return NextResponse.json({
			collectionId: data.collection.id,
			receiptNo: data.collection.receiptNo,
			reversed: data.reversed,
			verifyUrl,
			tenant: {
				legalName: branding.legalName ?? meta.tenant.name,
				address: branding.address ?? null,
				gstin: branding.gstin ?? null,
				phone: branding.phone ?? null,
			},
			agent: {
				name: meta.agentName,
				agentCode: meta.agentCode,
			},
			photo: photo
				? {
						url: photo.url,
						expiresInSeconds: photo.expiresInSeconds,
						mime: photoKey && photoKey.endsWith(".png") ? "image/png" : "image/jpeg",
					}
				: null,
			signature: signature
				? {
						url: signature.url,
						expiresInSeconds: signature.expiresInSeconds,
						mime: "image/png",
					}
				: null,
			logo: logo
				? {
						url: logo.url,
						expiresInSeconds: logo.expiresInSeconds,
						mime:
							logoKeyOrUrl && (logoKeyOrUrl.endsWith(".jpg") || logoKeyOrUrl.endsWith(".jpeg"))
								? "image/jpeg"
								: "image/png",
					}
				: null,
		});
	} catch (err) {
		return toResponse(err);
	}
}
