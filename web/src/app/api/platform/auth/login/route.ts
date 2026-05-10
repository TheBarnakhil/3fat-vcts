import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { platformUsers } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { signPlatformAccessToken } from "@/lib/auth/jwt";
import { PLATFORM_ACCESS_COOKIE } from "@/lib/auth/platform-context";
import { verifyPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import {
	badRequest,
	toResponse,
	tooMany,
	unauthorized,
} from "@/lib/errors";
import {
	limitLoginEmail,
	limitLoginIp,
	rateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
	email: z.string().email().max(254).toLowerCase(),
	password: z.string().min(1).max(256),
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
		const { email, password } = parsed.data;

		const ip =
			req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
			req.headers.get("x-real-ip") ??
			null;
		const ipRl = await limitLoginIp(ip ?? "unknown");
		const emailRl = await limitLoginEmail(`platform:${email}`);
		const rlHeaders = rateLimitHeaders(
			ipRl.remaining < emailRl.remaining ? ipRl : emailRl,
		);
		if (!ipRl.success || !emailRl.success) {
			const err = tooMany(
				"Too many login attempts. Wait a minute and try again.",
			);
			return NextResponse.json(
				{ error: { code: err.code, message: err.message } },
				{ status: err.status, headers: rlHeaders },
			);
		}

		const found = await withoutTenant(async (tx) => {
			const rows = await tx
				.select()
				.from(platformUsers)
				.where(eq(platformUsers.email, email))
				.limit(1);
			return rows[0];
		});

		if (!found || !found.isActive) throw unauthorized("Invalid credentials");
		const ok = await verifyPassword(password, found.passwordHash);
		if (!ok) throw unauthorized("Invalid credentials");

		await withoutTenant(async (tx) => {
			await tx
				.update(platformUsers)
				.set({ lastLoginAt: new Date(), updatedAt: new Date() })
				.where(eq(platformUsers.id, found.id));
		});

		const accessToken = await signPlatformAccessToken({
			sub: found.id,
			role: "platform_admin",
			name: found.name,
			email: found.email,
		});

		const res = NextResponse.json(
			{
				accessToken,
				expiresIn: parseExpiresIn(env.JWT_ACCESS_EXPIRES_IN),
				user: {
					id: found.id,
					email: found.email,
					name: found.name,
					role: "platform_admin",
				},
			},
			{ headers: rlHeaders },
		);
		res.cookies.set(PLATFORM_ACCESS_COOKIE, accessToken, {
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
