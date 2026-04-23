import { headers } from "next/headers";
import { forbidden, unauthorized } from "../errors";
import { verifyAccessToken, type AuthClaims } from "./jwt";

/**
 * Extracts + verifies the bearer token from either the Authorization header or
 * the `vcts_access` cookie. Throws `HttpError(401)` if missing/invalid.
 * Usage from a Route Handler:
 *
 *   const auth = await requireAuth();
 *   await withTenant(auth.tid, async (tx) => { ... });
 */
export async function requireAuth(): Promise<AuthClaims> {
	const h = await headers();
	const authHeader = h.get("authorization");
	let token: string | undefined;

	if (authHeader?.toLowerCase().startsWith("bearer ")) {
		token = authHeader.slice(7).trim();
	}
	// Cookie fallback (used by the web admin portal; mobile uses Authorization)
	if (!token) {
		const cookie = h.get("cookie") ?? "";
		const match = cookie.match(/(?:^|;\s*)vcts_access=([^;]+)/);
		if (match) token = decodeURIComponent(match[1]);
	}

	if (!token) throw unauthorized();

	try {
		return await verifyAccessToken(token);
	} catch {
		throw unauthorized("Invalid or expired token");
	}
}

export function requireRole(
	claims: AuthClaims,
	...allowed: AuthClaims["role"][]
): void {
	if (!allowed.includes(claims.role)) {
		throw forbidden(`Role ${claims.role} cannot perform this action`);
	}
}
