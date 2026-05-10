import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { tenants } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import {
	badRequest,
	notFound,
	serverError,
	tooMany,
	toResponse,
} from "@/lib/errors";
import { limitTenantBranding, rateLimitHeaders } from "@/lib/rate-limit";
import {
	brandingLogoKey,
	presignPutUrl,
	r2Enabled,
} from "@/lib/storage/r2";

export const runtime = "nodejs";

const Body = z.object({
	contentType: z
		.string()
		.regex(/^image\/(png|jpe?g|webp)$/i, {
			message: "Logo content type must be PNG / JPEG / WebP",
		}),
});

/**
 * Issues a tenant-prefixed presigned PUT URL for the branding logo.
 * Storage shape:
 *
 *   t/{tenantSlug}/branding/logo.png
 *
 * After PUT, the admin posts the resulting key back to PATCH
 * `/api/tenants/me` so it persists in `tenants.settings.branding.logoUrl`.
 * Only super_admin can mutate branding.
 */
export async function POST(req: NextRequest) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin");

		const rl = await limitTenantBranding(auth.tid);
		const rlHeaders = rateLimitHeaders(rl);
		if (!rl.success) {
			const err = tooMany("Too many branding uploads. Try again shortly.");
			return NextResponse.json(
				{ error: { code: err.code, message: err.message } },
				{ status: err.status, headers: rlHeaders },
			);
		}

		if (!r2Enabled()) {
			throw serverError(
				"Object storage is not configured. Branding uploads disabled.",
			);
		}
		const parsed = Body.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) {
			throw badRequest("Invalid body", parsed.error.flatten());
		}

		const [tenant] = await withoutTenant(async (tx) =>
			tx
				.select({ slug: tenants.slug })
				.from(tenants)
				.where(eq(tenants.id, auth.tid))
				.limit(1),
		);
		if (!tenant) throw notFound("Tenant not found");

		const key = brandingLogoKey(tenant.slug);
		const url = await presignPutUrl(key, parsed.data.contentType);
		return NextResponse.json(
			{
				url,
				key,
				method: "PUT",
				headers: { "Content-Type": parsed.data.contentType },
			},
			{ headers: rlHeaders },
		);
	} catch (err) {
		return toResponse(err);
	}
}
