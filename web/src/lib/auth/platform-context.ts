import { headers } from "next/headers";

import { unauthorized } from "@/lib/errors";
import {
	verifyPlatformAccessToken,
	type PlatformClaims,
} from "@/lib/auth/jwt";

export const PLATFORM_ACCESS_COOKIE = "vcts_platform_access";

/**
 * Platform-auth equivalent of requireAuth(). Deliberately separate from tenant
 * auth: different cookie, different JWT audience, different claims shape.
 */
export async function requirePlatformAuth(): Promise<PlatformClaims> {
	const h = await headers();
	const authHeader = h.get("authorization");
	let token: string | undefined;

	if (authHeader?.toLowerCase().startsWith("bearer ")) {
		token = authHeader.slice(7).trim();
	}

	if (!token) {
		const cookie = h.get("cookie") ?? "";
		const match = cookie.match(
			new RegExp(`(?:^|;\\s*)${PLATFORM_ACCESS_COOKIE}=([^;]+)`),
		);
		if (match) token = decodeURIComponent(match[1]);
	}

	if (!token) throw unauthorized();

	try {
		return await verifyPlatformAccessToken(token);
	} catch {
		throw unauthorized("Invalid or expired platform token");
	}
}
