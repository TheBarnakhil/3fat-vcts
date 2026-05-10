import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { tenantSignupRequests, tenants, users } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { badRequest, conflict, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const Body = z.object({
	token: z.string().min(20).max(256),
});

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
	try {
		const parsed = Body.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const tokenHash = hashToken(parsed.data.token);
		const now = new Date();

		const created = await withoutTenant(async (tx) => {
			const [request] = await tx
				.select()
				.from(tenantSignupRequests)
				.where(
					and(
						eq(tenantSignupRequests.tokenHash, tokenHash),
						isNull(tenantSignupRequests.consumedAt),
						gt(tenantSignupRequests.expiresAt, now),
					),
				)
				.limit(1)
				.for("update");

			if (!request) throw notFound("Verification link is invalid or expired");

			const existingTenant = await tx
				.select({ id: tenants.id })
				.from(tenants)
				.where(eq(tenants.slug, request.tenantSlug))
				.limit(1);
			if (existingTenant[0]) throw conflict("Tenant slug already exists");

			const existingUser = await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, request.adminEmail))
				.limit(1);
			if (existingUser[0]) throw conflict("Admin email already exists");

			const [tenant] = await tx
				.insert(tenants)
				.values({
					slug: request.tenantSlug,
					name: request.tenantName,
					settings: request.settings,
				})
				.returning();

			const [admin] = await tx
				.insert(users)
				.values({
					tenantId: tenant.id,
					email: request.adminEmail,
					passwordHash: request.passwordHash,
					name: request.adminName,
					role: "super_admin",
				})
				.returning({ id: users.id, email: users.email, name: users.name });

			await appendAudit(tx, {
				tenantId: tenant.id,
				actorId: admin.id,
				action: "tenant.signup_verified",
				entityType: "tenant",
				entityId: tenant.id,
				after: {
					slug: tenant.slug,
					name: tenant.name,
					adminEmail: admin.email,
					signupRequestId: request.id,
				},
			});

			await tx
				.update(tenantSignupRequests)
				.set({ verifiedAt: now, consumedAt: now })
				.where(eq(tenantSignupRequests.id, request.id));

			return { tenant, admin };
		});

		return NextResponse.json({
			ok: true,
			tenant: {
				id: created.tenant.id,
				slug: created.tenant.slug,
				name: created.tenant.name,
			},
			admin: created.admin,
		});
	} catch (err) {
		return toResponse(err);
	}
}
