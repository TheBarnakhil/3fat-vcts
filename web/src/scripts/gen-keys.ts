/**
 * Generates a fresh RS256 keypair and two random secrets, printed as lines ready
 * to paste into `.env.local`. Run once at project bootstrap and again whenever
 * you need to rotate keys (rotating invalidates all existing tokens / breaks
 * audit-chain integrity - handle with care in production).
 *
 *   pnpm keys:generate
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";

function b64(pem: string): string {
	return Buffer.from(pem, "utf8").toString("base64");
}

function secret(bytes = 32): string {
	return randomBytes(bytes).toString("base64url");
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Neon's default role has BYPASSRLS, so we provision a second DB role
// (vcts_app) for runtime queries. Its password is just another secret.
function dbPassword(bytes = 24): string {
	// Keep it URL-safe and short enough to paste into connection strings
	return randomBytes(bytes).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 28);
}

const lines = [
	`JWT_PRIVATE_KEY_BASE64="${b64(privateKey)}"`,
	`JWT_PUBLIC_KEY_BASE64="${b64(publicKey)}"`,
	`PASSWORD_PEPPER="${secret(32)}"`,
	`AUDIT_HMAC_SECRET="${secret(32)}"`,
	`APP_DB_PASSWORD="${dbPassword()}"`,
];

console.log("\nPaste into .env.local (replace any existing values):\n");
console.log(lines.join("\n"));
console.log("");
