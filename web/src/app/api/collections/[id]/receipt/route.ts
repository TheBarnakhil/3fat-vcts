import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import {
	collectionReversals,
	collections as collectionsTable,
	customers,
	tenants,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { forbidden, notFound, toResponse } from "@/lib/errors";
import { fetchStaticMapPng } from "@/lib/maps/static";
import { readBranding } from "@/lib/tenants/branding";
import { publicReceiptUrl } from "@/lib/receipts/public-url";
import { renderReceiptPdf, type ReceiptAttachments } from "@/lib/receipts/pdf";
import {
	getObjectBytes,
	presignGetUrl,
	putObject,
	r2Enabled,
	receiptKey,
} from "@/lib/storage/r2";

export const runtime = "nodejs";

export async function GET(
	req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		const { id } = await ctx.params;
		const url = new URL(req.url);
		// `?presign=1` returns a JSON `{ url }` you can stream from R2 directly
		// (used by mobile to avoid wedging a serverless function on a 200 KB PDF
		// download). Default streams the PDF inline.
		const wantPresign = url.searchParams.get("presign") === "1";

		// Fetch tenant-scoped collection + customer; cross-tenant access is
		// blocked by RLS automatically.
		const data = await withTenant(auth.tid, async (tx) => {
			const [row] = await tx
				.select({
					collection: collectionsTable,
					customer: customers,
				})
				.from(collectionsTable)
				.innerJoin(customers, eq(customers.id, collectionsTable.customerId))
				.where(eq(collectionsTable.id, id))
				.limit(1);
			if (!row) return null;

			const reversals = await tx
				.select({ id: collectionReversals.id })
				.from(collectionReversals)
				.where(eq(collectionReversals.originalCollectionId, id))
				.limit(1);

			return { ...row, reversed: reversals.length > 0 };
		});

		if (!data) throw notFound("Collection not found");
		if (auth.role === "agent" && data.collection.agentId !== auth.sub) {
			throw forbidden("This collection is not yours");
		}

		// Tenant + agent metadata via the auth-only path.
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
		const tenantInfo = {
			legalName: branding.legalName ?? meta.tenant.name,
			address: branding.address,
			gstin: branding.gstin,
			phone: branding.phone,
		};

		const verifyUrl = publicReceiptUrl({
			receiptNo: data.collection.receiptNo,
			origin:
				url.origin && !url.origin.includes("localhost")
					? url.origin
					: undefined,
		});

		// Best-effort fetch of the bytes we want to embed in the PDF. R2
		// objects might not exist yet (the device only uploads after the
		// receipt becomes available); the static map call hits Google
		// directly and is rate-limited at the project level. Each fetch
		// failure is silently swallowed - the renderer paints "Not
		// captured" placeholders for missing attachments.
		const attachments: ReceiptAttachments = {};
		if (r2Enabled() && data.collection.photoUrl) {
			const bytes = await getObjectBytes(data.collection.photoUrl);
			if (bytes) {
				attachments.photo = {
					bytes,
					mime: data.collection.photoUrl.endsWith(".png")
						? "image/png"
						: "image/jpeg",
				};
			}
		}
		if (r2Enabled() && data.collection.signatureUrl) {
			const bytes = await getObjectBytes(data.collection.signatureUrl);
			if (bytes) attachments.signature = { bytes, mime: "image/png" };
		}
		if (r2Enabled() && branding.logoUrl) {
			// Logo URL is stored as an R2 key (or absolute URL); we only
			// embed when it's a key we can look up.
			const looksLikeKey = branding.logoUrl.startsWith("t/");
			const logoBytes = looksLikeKey
				? await getObjectBytes(branding.logoUrl)
				: await fetch(branding.logoUrl)
						.then((r) => (r.ok ? r.arrayBuffer() : null))
						.then((b) => (b ? Buffer.from(b) : null))
						.catch(() => null);
			if (logoBytes) {
				attachments.logo = {
					bytes: logoBytes,
					mime: branding.logoUrl.endsWith(".jpg") || branding.logoUrl.endsWith(".jpeg")
						? "image/jpeg"
						: "image/png",
				};
			}
		}
		const mapBytes = await fetchStaticMapPng({
			lat: data.collection.collectionLat,
			lng: data.collection.collectionLng,
			zoom: 16,
		});
		if (mapBytes) attachments.mapThumbnail = { bytes: mapBytes, mime: "image/png" };

		const key = receiptKey(meta.tenant.slug, data.collection.receiptNo);

		// Stable receipt input - reused by the cached / inline branches.
		const baseInput = {
			tenant: tenantInfo,
			receiptNo: data.collection.receiptNo,
			collectedAt: data.collection.collectedAt,
			customer: {
				name: data.customer.name,
				code: data.customer.code,
				address: data.customer.address,
				phone: data.customer.phone,
			},
			agent: {
				name: meta.agentName,
				agentCode: meta.agentCode,
			},
			amount: data.collection.amount,
			paymentMode: data.collection.paymentMode,
			refNo: data.collection.refNo,
			chequeDate: data.collection.chequeDate as Date | null,
			remarks: data.collection.remarks,
			location: {
				lat: data.collection.collectionLat,
				lng: data.collection.collectionLng,
				accuracyM: data.collection.gpsAccuracyM,
			},
			reversed: data.reversed,
			attachments,
			verifyUrl,
		};

		// --- R2 path: re-render every time so attachments/branding stay
		// in sync with the latest writes. The cached PDF would otherwise
		// go stale the moment the agent uploaded a photo or signature
		// after the receipt was first viewed. PDF generation is < 1s so
		// the round-trip cost is acceptable.
		if (r2Enabled()) {
			const pdfBytes = await renderReceiptPdf(baseInput);
			await putObject(key, Buffer.from(pdfBytes), "application/pdf");

			const signed = await presignGetUrl(key);
			if (wantPresign) {
				return NextResponse.json({ url: signed });
			}
			return NextResponse.redirect(signed, { status: 302 });
		}

		// --- Inline streaming fallback (no R2 configured) ------------------
		const pdfBytes = await renderReceiptPdf(baseInput);

		const filename = `${data.collection.receiptNo.replace(/\//g, "-")}.pdf`;
		// Buffer is fine; pdf-lib returns a Uint8Array which Response accepts
		// natively, but wrapping in Buffer makes Content-Length deterministic
		// across runtimes.
		const buf = Buffer.from(pdfBytes);
		return new NextResponse(new Uint8Array(buf), {
			status: 200,
			headers: {
				"Content-Type": "application/pdf",
				"Content-Length": String(buf.length),
				"Content-Disposition": `inline; filename="${filename}"`,
				"Cache-Control": "private, max-age=60",
			},
		});
	} catch (err) {
		return toResponse(err);
	}
}
