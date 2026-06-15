import { NextResponse, type NextRequest } from "next/server";

import { cmsItemContext } from "@/lib/cms/context";
import { allowlistedItemQuery, directusFetch } from "@/lib/cms/directus";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ collection: string; id: string }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
	try {
		const { collection: raw, id } = await ctx.params;
		const { collection, token } = await cmsItemContext(raw);
		const qs = allowlistedItemQuery(req.nextUrl.searchParams);

		const data = await directusFetch<{ data?: unknown; meta?: unknown }>(
			`/items/${collection}/${encodeURIComponent(id)}${qs}`,
			{ token },
		);
		return NextResponse.json(data);
	} catch (err) {
		return toResponse(err);
	}
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
	try {
		const { collection: raw, id } = await ctx.params;
		const { collection, token } = await cmsItemContext(raw);
		const body = await req.json().catch(() => null);
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			throw badRequest("Request body must be a JSON object");
		}

		const data = await directusFetch<{ data?: unknown }>(
			`/items/${collection}/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				token,
				body: JSON.stringify(body),
			},
		);
		return NextResponse.json(data);
	} catch (err) {
		return toResponse(err);
	}
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
	try {
		const { collection: raw, id } = await ctx.params;
		const { collection, token } = await cmsItemContext(raw);

		await directusFetch(`/items/${collection}/${encodeURIComponent(id)}`, {
			method: "DELETE",
			token,
		});
		return new NextResponse(null, { status: 204 });
	} catch (err) {
		return toResponse(err);
	}
}
