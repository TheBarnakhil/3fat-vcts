import { createHash, randomBytes } from "node:crypto";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { env } from "../env";

const ALG = "RS256";
const ISSUER = "vcts";
const ACCESS_AUD = "vcts-api";
const REFRESH_AUD = "vcts-refresh";

export type AuthClaims = {
	/** user id */
	sub: string;
	/** tenant id */
	tid: string;
	/** role */
	role: "super_admin" | "manager" | "agent" | "auditor";
	/** tenant slug - included so clients can show it without an extra fetch */
	tslug: string;
	/** user display name */
	name: string;
	/**
	 * Device fingerprint (sha256 hex of the device's install UUID). Phase
	 * 10 / Track B. Optional so legacy clients without an installId keep
	 * working during the rollout window; new clients always include it
	 * and the refresh flow enforces it against the stored value.
	 */
	dfp?: string;
};

let privateKeyPromise: Promise<CryptoKey> | null = null;
let publicKeyPromise: Promise<CryptoKey> | null = null;

function privateKey(): Promise<CryptoKey> {
	if (!privateKeyPromise) {
		const pem = Buffer.from(env.JWT_PRIVATE_KEY_BASE64, "base64").toString("utf8");
		privateKeyPromise = importPKCS8(pem, ALG);
	}
	return privateKeyPromise;
}

function publicKey(): Promise<CryptoKey> {
	if (!publicKeyPromise) {
		const pem = Buffer.from(env.JWT_PUBLIC_KEY_BASE64, "base64").toString("utf8");
		publicKeyPromise = importSPKI(pem, ALG);
	}
	return publicKeyPromise;
}

export async function signAccessToken(claims: AuthClaims): Promise<string> {
	return new SignJWT({ ...claims })
		.setProtectedHeader({ alg: ALG })
		.setSubject(claims.sub)
		.setIssuer(ISSUER)
		.setAudience(ACCESS_AUD)
		.setIssuedAt()
		.setExpirationTime(env.JWT_ACCESS_EXPIRES_IN)
		.sign(await privateKey());
}

export async function verifyAccessToken(token: string): Promise<AuthClaims> {
	const { payload } = await jwtVerify(token, await publicKey(), {
		issuer: ISSUER,
		audience: ACCESS_AUD,
	});
	return payload as unknown as AuthClaims;
}

/**
 * Refresh tokens are opaque random strings (not JWTs). We sign a JWT for the
 * access token because it carries claims the client reads; refresh tokens are
 * just bearer handles that resolve to a DB row (revocable on logout / password
 * change). We store only a SHA-256 of the token, so a DB leak doesn't expose
 * usable credentials.
 */
export function generateRefreshToken(): { token: string; tokenHash: string } {
	const token = randomBytes(48).toString("base64url");
	const tokenHash = createHash("sha256").update(token).digest("hex");
	return { token, tokenHash };
}

export function hashRefreshToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export { REFRESH_AUD };
