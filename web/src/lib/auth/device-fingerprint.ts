import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Phase 10 - Track B
 *
 * The Android client generates a stable install UUID on first launch, stores
 * it in DataStore, and sends it as `installId` on every login + refresh
 * request. The server hashes that UUID and persists the digest on the
 * `refresh_tokens` row. At refresh time, the server compares the supplied
 * `installId`'s digest to the stored value and rejects the refresh on
 * mismatch.
 *
 * Threat model (what this protects against):
 *   - An attacker who exfiltrates only the refresh token (e.g. by reading
 *     the encrypted shared prefs file off a stolen device) cannot replay
 *     it from a different device because their device's install UUID
 *     hashes to a different fingerprint.
 *   - An attacker who exfiltrates *both* the refresh token and the install
 *     UUID can still impersonate the device. EncryptedSharedPreferences
 *     keeps the refresh token at rest; the install UUID lives in plain
 *     DataStore (separate file). Defeating that requires root access, at
 *     which point all bets are off anyway.
 *
 * What this does NOT protect against (yet):
 *   - Live request hijacking (mTLS / cert pinning is the answer there;
 *     SPKI hash work is queued for Track D).
 *   - Token theft on the same device (post-root) - same as above.
 */

/** Validates an install UUID. Permissive on length to accept future schemes. */
export const InstallIdSchema = z
	.string()
	.trim()
	.min(8)
	.max(128)
	.regex(/^[a-zA-Z0-9._:-]+$/, {
		message:
			"installId must be 8-128 chars of letters, digits, or [._:-]",
	});

/**
 * Returns the SHA-256 hex digest of the install UUID. This is what we
 * store in `refresh_tokens.device_fingerprint` and embed in the access
 * token's `dfp` claim. Lower-cased hex so equality compares cleanly
 * regardless of who computed which side.
 */
export function deviceFingerprint(installId: string): string {
	return createHash("sha256").update(installId).digest("hex");
}

/**
 * Helper: returns the fingerprint for a (possibly null/undefined)
 * installId. Convenient at login where the legacy path skips the check.
 */
export function deviceFingerprintOrNull(
	installId: string | null | undefined,
): string | null {
	if (!installId) return null;
	return deviceFingerprint(installId);
}
