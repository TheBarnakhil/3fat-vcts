import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { tenants } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import {
	parseTenantTokens,
	resolveTenantSlug,
	tenantCollectionPrefix,
} from "@/lib/cms/directus";
import { env } from "@/lib/env";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

/** Returns tenant-scoped CMS doc context + the caller's JWT for Try-it / cURL. */
export async function GET() {
	try {
		const auth = await requireAuth();
		const slug = await resolveTenantSlug(auth.tid);
		const tokenMap = parseTenantTokens(env.DIRECTUS_TENANT_TOKENS);

		const [tenant] = await withoutTenant(async (tx) =>
			tx
				.select({ name: tenants.name, slug: tenants.slug })
				.from(tenants)
				.where(eq(tenants.id, auth.tid))
				.limit(1),
		);

		const h = await headers();
		let bearerToken: string | undefined;
		const authHeader = h.get("authorization");
		if (authHeader?.toLowerCase().startsWith("bearer ")) {
			bearerToken = authHeader.slice(7).trim();
		} else {
			const cookie = h.get("cookie") ?? "";
			const match = cookie.match(/(?:^|;\s*)vcts_access=([^;]+)/);
			if (match) bearerToken = decodeURIComponent(match[1]);
		}

		return NextResponse.json({
			tenant: {
				id: auth.tid,
				slug: tenant?.slug ?? slug,
				name: tenant?.name ?? slug,
			},
			collectionPrefix: tenantCollectionPrefix(slug),
			directusConfigured: Boolean(tokenMap[slug]),
			/** VCTS JWT for this tenant — use as Bearer on /api/cms/* (not the Directus static token). */
			bearerToken: bearerToken ?? null,
			directusTokenConfigured: Boolean(tokenMap[slug]),
			exampleCollections: ["products", "customer_notes", "collection_responses"],
		});
	} catch (err) {
		return toResponse(err);
	}
}
