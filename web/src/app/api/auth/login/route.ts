import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { refreshTokens, tenants, users } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import {
	generateRefreshToken,
	signAccessToken,
	type AuthClaims,
} from "@/lib/auth/jwt";
import { verifyPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import { badRequest, toResponse, unauthorized } from "@/lib/errors";

export const runtime = "nodejs";

const Body = z.object({
	email: z.string().email().toLowerCase(),
	password: z.string().min(1),
	deviceId: z.string().optional(),
});

function parseExpiresIn(spec: string): number {
	const m = spec.match(/^(\d+)([smhd])$/);
	if (!m) throw new Error(`Bad duration spec: ${spec}`);
	const n = Number(m[1]);
	switch (m[2]) {
		case "s":
			return n;
		case "m":
			return n * 60;
		case "h":
			return n * 3600;
		case "d":
			return n * 86400;
		default:
			throw new Error(`Bad unit: ${m[2]}`);
	}
}

export async function POST(req: NextRequest) {
	try {
		const parsed = Body.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const { email, password, deviceId } = parsed.data;

		// Global email lookup: we don't know the tenant yet, so bypass RLS.
		// Returns at most one row because users.email is globally unique.
		const found = await withoutTenant(async (tx) => {
			const rows = await tx
				.select({
					id: users.id,
					tenantId: users.tenantId,
					email: users.email,
					passwordHash: users.passwordHash,
					name: users.name,
					role: users.role,
					isActive: users.isActive,
					tenantSlug: tenants.slug,
					tenantIsActive: tenants.isActive,
				})
				.from(users)
				.innerJoin(tenants, eq(tenants.id, users.tenantId))
				.where(eq(users.email, email))
				.limit(1);
			return rows[0];
		});

		if (!found || !found.isActive || !found.tenantIsActive) {
			throw unauthorized("Invalid credentials");
		}

		const ok = await verifyPassword(password, found.passwordHash);
		if (!ok) throw unauthorized("Invalid credentials");

		const claims: AuthClaims = {
			sub: found.id,
			tid: found.tenantId,
			role: found.role,
			tslug: found.tenantSlug,
			name: found.name,
		};
		const accessToken = await signAccessToken(claims);

		// Opaque refresh token: store only the hash server-side. Insert inside
		// the tenant transaction so RLS still applies (same tenant writing
		// its own refresh row).
		const { token: refreshToken, tokenHash } = generateRefreshToken();
		const refreshSeconds = parseExpiresIn(env.JWT_REFRESH_EXPIRES_IN);
		const expiresAt = new Date(Date.now() + refreshSeconds * 1000);

		const ip =
			req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
			req.headers.get("x-real-ip") ??
			null;
		const userAgent = req.headers.get("user-agent");

		// Login writes live on auth-only tables (users, refresh_tokens) that
		// app-role lacks privileges on, so we stay on the admin connection.
		// appendAudit sets tenant_id explicitly and filters its FOR UPDATE read
		// by tenant_id, so the chain stays tenant-scoped even with RLS bypassed.
		await withoutTenant(async (tx) => {
			await tx.insert(refreshTokens).values({
				tenantId: found.tenantId,
				userId: found.id,
				tokenHash,
				deviceId: deviceId ?? null,
				expiresAt,
			});
			await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, found.id));
			await appendAudit(tx, {
				tenantId: found.tenantId,
				actorId: found.id,
				action: "auth.login",
				entityType: "user",
				entityId: found.id,
				ip,
				deviceId: deviceId ?? null,
				userAgent,
			});
		});

		const body = {
			accessToken,
			refreshToken,
			expiresIn: parseExpiresIn(env.JWT_ACCESS_EXPIRES_IN),
			user: {
				id: found.id,
				email: found.email,
				name: found.name,
				role: found.role,
				tenantId: found.tenantId,
				tenantSlug: found.tenantSlug,
			},
		};

		const res = NextResponse.json(body);
		// Also set an httpOnly cookie so the web admin can use cookie-based auth.
		res.cookies.set("vcts_access", accessToken, {
			httpOnly: true,
			secure: env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: parseExpiresIn(env.JWT_ACCESS_EXPIRES_IN),
		});
		return res;
	} catch (err) {
		return toResponse(err);
	}
}
