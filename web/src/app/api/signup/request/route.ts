import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { tenantSignupRequests, tenants, users } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { hashPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import { badRequest, conflict, toResponse } from "@/lib/errors";
import {
	sendSignupVerificationEmail,
	signupEmailConfigured,
	signupVerificationUrl,
} from "@/lib/signup/verification-email";

export const runtime = "nodejs";

const Body = z.object({
	tenantSlug: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, {
			message: "Slug must be 3-50 chars of lowercase letters, numbers, or hyphens",
		}),
	tenantName: z.string().trim().min(2).max(120),
	adminEmail: z.string().email().max(254).toLowerCase(),
	adminName: z.string().trim().min(2).max(120),
	adminPassword: z.string().min(8).max(256),
});

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
	try {
		const parsed = Body.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const body = parsed.data;

		const passwordHash = await hashPassword(body.adminPassword);
		const token = randomBytes(32).toString("base64url");
		const tokenHash = hashToken(token);
		const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const settings = {
			branding: {
				legalName: body.tenantName,
				accentHsl: "221 83% 53%",
			},
			geofence: { defaultRadiusM: 100, minAccuracyM: 50 },
			sync: { intervalMin: 15 },
		};

		await withoutTenant(async (tx) => {
			const existingTenant = await tx
				.select({ id: tenants.id })
				.from(tenants)
				.where(eq(tenants.slug, body.tenantSlug))
				.limit(1);
			if (existingTenant[0]) throw conflict("Tenant slug already exists");

			const existingUser = await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, body.adminEmail))
				.limit(1);
			if (existingUser[0]) throw conflict("Admin email already exists");

			const existingPending = await tx
				.select({ id: tenantSignupRequests.id })
				.from(tenantSignupRequests)
				.where(eq(tenantSignupRequests.adminEmail, body.adminEmail))
				.limit(1);
			if (existingPending[0]) {
				await tx
					.update(tenantSignupRequests)
					.set({
						tenantSlug: body.tenantSlug,
						tenantName: body.tenantName,
						adminName: body.adminName,
						passwordHash,
						tokenHash,
						settings,
						expiresAt,
						verifiedAt: null,
						consumedAt: null,
					})
					.where(eq(tenantSignupRequests.id, existingPending[0].id));
				return;
			}

			await tx.insert(tenantSignupRequests).values({
				tenantSlug: body.tenantSlug,
				tenantName: body.tenantName,
				adminEmail: body.adminEmail,
				adminName: body.adminName,
				passwordHash,
				tokenHash,
				settings,
				expiresAt,
			});
		});

		const verifyUrl = signupVerificationUrl({ origin: req.nextUrl.origin, token });
		await sendSignupVerificationEmail({
			to: body.adminEmail,
			tenantName: body.tenantName,
			verifyUrl,
		});

		return NextResponse.json({
			ok: true,
			email: body.adminEmail,
			expiresAt: expiresAt.toISOString(),
			emailDeliveryConfigured: signupEmailConfigured(),
			// Useful for local/dev verification. In production this is omitted
			// unless an email provider is configured and sends the link.
			...(env.NODE_ENV !== "production" ? { verificationUrl: verifyUrl } : {}),
		});
	} catch (err) {
		return toResponse(err);
	}
}
