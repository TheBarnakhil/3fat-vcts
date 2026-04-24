import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { tenants, users } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

// `users` and `tenants` are AUTH_ONLY tables - the RLS-enforced `vcts_app`
// role has NO grants on them, so we must run this as `neondb_owner` via
// `withoutTenant` and apply tenant scoping ourselves with an explicit
// `auth.tid` predicate.
export async function GET() {
	try {
		const auth = await requireAuth();
		const result = await withoutTenant(async (tx) => {
			const [userRow] = await tx
				.select({
					id: users.id,
					email: users.email,
					name: users.name,
					role: users.role,
					tenantId: users.tenantId,
					agentCode: users.agentCode,
					lastLoginAt: users.lastLoginAt,
				})
				.from(users)
				.where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tid)))
				.limit(1);
			if (!userRow) return null;
			const [tenantRow] = await tx
				.select({
					id: tenants.id,
					slug: tenants.slug,
					name: tenants.name,
					settings: tenants.settings,
				})
				.from(tenants)
				.where(eq(tenants.id, auth.tid))
				.limit(1);
			const settings = (tenantRow?.settings ?? {}) as {
				accentHsl?: string;
				logoUrl?: string;
			};
			return {
				user: userRow,
				tenant: {
					id: tenantRow?.id,
					slug: tenantRow?.slug,
					name: tenantRow?.name,
					accentHsl: settings.accentHsl ?? null,
					logoUrl: settings.logoUrl ?? null,
				},
			};
		});
		if (!result) {
			return NextResponse.json(
				{ error: { code: "not_found", message: "User no longer exists" } },
				{ status: 404 },
			);
		}
		return NextResponse.json(result);
	} catch (err) {
		return toResponse(err);
	}
}
