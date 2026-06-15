import { NextResponse, type NextRequest } from "next/server";

import { cmsAuthTenant } from "@/lib/cms/context";
import {
	assertTenantCollection,
	directusFetch,
	requireAdminToken,
	tenantCollectionPrefix,
} from "@/lib/cms/directus";
import { requireRole } from "@/lib/auth/context";
import { ensureTenantCollectionPermissions } from "@/lib/cms/provision";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
	try {
		const { slug } = await cmsAuthTenant();
		const prefix = tenantCollectionPrefix(slug);
		const filter = encodeURIComponent(
			JSON.stringify({ collection: { _starts_with: prefix } }),
		);
		const token = requireAdminToken();

		const data = await directusFetch<{ data?: unknown[] }>(
			`/collections?filter=${filter}&sort=collection`,
			{ token },
		);
		return NextResponse.json(data);
	} catch (err) {
		return toResponse(err);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { auth, slug } = await cmsAuthTenant();
		requireRole(auth, "super_admin");

		const body = await req.json().catch(() => null);
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			throw badRequest("Request body must be a JSON object");
		}

		const rawName =
			typeof (body as { collection?: unknown }).collection === "string"
				? (body as { collection: string }).collection
				: null;
		if (!rawName) throw badRequest("collection name is required");

		const collection = assertTenantCollection(slug, rawName);
		const token = requireAdminToken();
		const payload = { ...(body as Record<string, unknown>), collection };

		const data = await directusFetch<{ data?: unknown }>("/collections", {
			method: "POST",
			token,
			body: JSON.stringify(payload),
		});
		await ensureTenantCollectionPermissions(slug, collection);
		return NextResponse.json(data, { status: 201 });
	} catch (err) {
		return toResponse(err);
	}
}
