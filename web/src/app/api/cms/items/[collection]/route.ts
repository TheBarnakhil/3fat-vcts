import { NextResponse, type NextRequest } from "next/server";

import {
	allowlistedItemQuery,
	assertTenantCollection,
	directusFetch,
	resolveTenantSlug,
	tenantDirectusToken,
} from "@/lib/cms/directus";
import { requireAuth } from "@/lib/auth/context";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ collection: string }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
	try {
		const auth = await requireAuth();
		const slug = await resolveTenantSlug(auth.tid);
		const { collection: raw } = await ctx.params;
		const collection = assertTenantCollection(slug, decodeURIComponent(raw));
		const token = tenantDirectusToken(slug);
		const qs = allowlistedItemQuery(req.nextUrl.searchParams);

		const data = await directusFetch<{ data?: unknown; meta?: unknown }>(
			`/items/${collection}${qs}`,
			{ token },
		);
		return NextResponse.json(data);
	} catch (err) {
		return toResponse(err);
	}
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
	try {
		const auth = await requireAuth();
		const slug = await resolveTenantSlug(auth.tid);
		const { collection: raw } = await ctx.params;
		const collection = assertTenantCollection(slug, decodeURIComponent(raw));
		const token = tenantDirectusToken(slug);
		const body = await req.json().catch(() => null);
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			throw badRequest("Request body must be a JSON object");
		}

		const data = await directusFetch<{ data?: unknown }>(`/items/${collection}`, {
			method: "POST",
			token,
			body: JSON.stringify(body),
		});
		return NextResponse.json(data, { status: 201 });
	} catch (err) {
		return toResponse(err);
	}
}
