import { NextResponse, type NextRequest } from "next/server";

import { cmsSchemaContext } from "@/lib/cms/context";
import { directusFetch } from "@/lib/cms/directus";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ collection: string; field: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
	try {
		const { collection: raw, field } = await ctx.params;
		const { collection, token } = await cmsSchemaContext(raw);

		const data = await directusFetch<{ data?: unknown }>(
			`/fields/${collection}/${encodeURIComponent(field)}`,
			{ token },
		);
		return NextResponse.json(data);
	} catch (err) {
		return toResponse(err);
	}
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
	try {
		const { collection: raw, field } = await ctx.params;
		const { collection, token } = await cmsSchemaContext(raw, { superAdmin: true });
		const body = await req.json().catch(() => null);
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			throw badRequest("Request body must be a JSON object");
		}

		const data = await directusFetch<{ data?: unknown }>(
			`/fields/${collection}/${encodeURIComponent(field)}`,
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
		const { collection: raw, field } = await ctx.params;
		const { collection, token } = await cmsSchemaContext(raw, { superAdmin: true });

		await directusFetch(`/fields/${collection}/${encodeURIComponent(field)}`, {
			method: "DELETE",
			token,
		});
		return new NextResponse(null, { status: 204 });
	} catch (err) {
		return toResponse(err);
	}
}
