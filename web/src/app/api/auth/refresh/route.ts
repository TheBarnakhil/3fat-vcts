import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { refreshTokens, tenants, users } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import {
	generateRefreshToken,
	hashRefreshToken,
	signAccessToken,
	type AuthClaims,
} from "@/lib/auth/jwt";
import { env } from "@/lib/env";
import { badRequest, toResponse, unauthorized } from "@/lib/errors";

export const runtime = "nodejs";

const Body = z.object({
	refreshToken: z.string().min(1),
});

function parseExpiresIn(spec: string): number {
	const m = spec.match(/^(\d+)([smhd])$/);
	if (!m) throw new Error(`Bad duration spec: ${spec}`);
	const n = Number(m[1]);
	const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
	return n * mult;
}

export async function POST(req: NextRequest) {
	try {
		const parsed = Body.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const tokenHash = hashRefreshToken(parsed.data.refreshToken);

		// Resolve the refresh token (bypass RLS: we don't know the tenant yet)
		const found = await withoutTenant(async (tx) => {
			const rows = await tx
				.select({
					id: refreshTokens.id,
					tenantId: refreshTokens.tenantId,
					userId: refreshTokens.userId,
					deviceId: refreshTokens.deviceId,
					email: users.email,
					name: users.name,
					role: users.role,
					isActive: users.isActive,
					tenantSlug: tenants.slug,
					tenantIsActive: tenants.isActive,
				})
				.from(refreshTokens)
				.innerJoin(users, eq(users.id, refreshTokens.userId))
				.innerJoin(tenants, eq(tenants.id, refreshTokens.tenantId))
				.where(
					and(
						eq(refreshTokens.tokenHash, tokenHash),
						isNull(refreshTokens.revokedAt),
						gt(refreshTokens.expiresAt, new Date()),
					),
				)
				.limit(1);
			return rows[0];
		});

		if (!found || !found.isActive || !found.tenantIsActive) {
			throw unauthorized("Invalid or expired refresh token");
		}

		// Rotate: revoke old, issue new. If an attacker is replaying a token we
		// issued to the real user, the real user will get an unauthorized on
		// their next refresh, which is the normal way to detect theft.
		const { token: nextRefresh, tokenHash: nextHash } = generateRefreshToken();
		const refreshSeconds = parseExpiresIn(env.JWT_REFRESH_EXPIRES_IN);
		const expiresAt = new Date(Date.now() + refreshSeconds * 1000);

		// refresh_tokens is an auth-only table (app role has no privs) so stay
		// on the admin connection for the rotate.
		await withoutTenant(async (tx) => {
			await tx
				.update(refreshTokens)
				.set({ revokedAt: new Date() })
				.where(eq(refreshTokens.id, found.id));
			await tx.insert(refreshTokens).values({
				tenantId: found.tenantId,
				userId: found.userId,
				tokenHash: nextHash,
				deviceId: found.deviceId,
				expiresAt,
			});
		});

		const claims: AuthClaims = {
			sub: found.userId,
			tid: found.tenantId,
			role: found.role,
			tslug: found.tenantSlug,
			name: found.name,
		};
		const accessToken = await signAccessToken(claims);

		const res = NextResponse.json({
			accessToken,
			refreshToken: nextRefresh,
			expiresIn: parseExpiresIn(env.JWT_ACCESS_EXPIRES_IN),
		});
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
