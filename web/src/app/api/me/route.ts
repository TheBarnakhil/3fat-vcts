import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
	try {
		const auth = await requireAuth();
		const me = await withTenant(auth.tid, async (tx) => {
			const rows = await tx
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
				.where(eq(users.id, auth.sub))
				.limit(1);
			return rows[0];
		});
		return NextResponse.json({ user: me, tenant: { id: auth.tid, slug: auth.tslug } });
	} catch (err) {
		return toResponse(err);
	}
}
