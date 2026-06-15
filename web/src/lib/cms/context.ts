import { requireAuth, requireRole } from "@/lib/auth/context";
import type { AuthClaims } from "@/lib/auth/jwt";
import {
	assertTenantCollection,
	requireAdminToken,
	resolveTenantSlug,
	tenantDirectusToken,
} from "@/lib/cms/directus";

export async function cmsAuthTenant(): Promise<{ auth: AuthClaims; slug: string }> {
	const auth = await requireAuth();
	const slug = await resolveTenantSlug(auth.tid);
	return { auth, slug };
}

export async function cmsItemContext(rawCollection: string) {
	const { auth, slug } = await cmsAuthTenant();
	const collection = assertTenantCollection(slug, decodeURIComponent(rawCollection));
	const token = tenantDirectusToken(slug);
	return { auth, slug, collection, token };
}

/** Schema ops use admin token but only on tenant-prefixed collections. */
export async function cmsSchemaContext(
	rawCollection: string,
	opts?: { superAdmin?: boolean },
) {
	const { auth, slug } = await cmsAuthTenant();
	if (opts?.superAdmin) requireRole(auth, "super_admin");
	const collection = assertTenantCollection(slug, decodeURIComponent(rawCollection));
	const token = requireAdminToken();
	return { auth, slug, collection, token };
}
