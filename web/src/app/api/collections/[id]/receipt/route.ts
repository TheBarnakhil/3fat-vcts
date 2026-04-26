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
import { renderReceiptPdf } from "@/lib/receipts/pdf";
import {
	objectExists,
	presignGetUrl,
	putObject,
	r2Enabled,
	receiptKey,
} from "@/lib/storage/r2";

export const runtime = "nodejs";

type TenantBranding = {
	branding?: {
		legalName?: string;
		address?: string;
		gstin?: string;
		phone?: string;
	};
};

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

		const branding = (meta.tenant.settings as TenantBranding | null)
			?.branding;
		const tenantInfo = {
			legalName: branding?.legalName ?? meta.tenant.name,
			address: branding?.address,
			gstin: branding?.gstin,
			phone: branding?.phone,
		};

		const key = receiptKey(meta.tenant.slug, data.collection.receiptNo);

		// --- R2 path: cache PDF on first request, serve presigned URL ------
		if (r2Enabled()) {
			let exists = await objectExists(key);
			if (!exists) {
				const pdfBytes = await renderReceiptPdf({
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
				});
				await putObject(key, Buffer.from(pdfBytes), "application/pdf");
				exists = true;
			}

			const signed = await presignGetUrl(key);
			if (wantPresign) {
				return NextResponse.json({ url: signed });
			}
			// 302 to the presigned URL keeps the browser tab simple.
			return NextResponse.redirect(signed, { status: 302 });
		}

		// --- Inline streaming fallback (no R2 configured) ------------------
		const pdfBytes = await renderReceiptPdf({
			tenant: tenantInfo,
			receiptNo: data.collection.receiptNo,
			collectedAt: data.collection.collectedAt,
			customer: {
				name: data.customer.name,
				code: data.customer.code,
				address: data.customer.address,
				phone: data.customer.phone,
			},
			agent: { name: meta.agentName, agentCode: meta.agentCode },
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
		});

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
