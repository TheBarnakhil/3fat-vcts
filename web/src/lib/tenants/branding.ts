import { z } from "zod";

/**
 * Tenant branding lives inside `tenants.settings -> 'branding'` so we don't
 * have to migrate when fields move around. Phase 8 cares about three things:
 *
 *   - legalName / address / gstin / phone   (printed on the PDF + verify page)
 *   - logoUrl                                (R2 key, served via /api/branding)
 *   - accentHsl                              (UI accent in admin + verify page)
 *
 * Everything is optional - the receipt route falls back to `tenants.name`.
 */

export const TenantBrandingSchema = z
	.object({
		legalName: z.string().trim().min(1).max(120).optional(),
		address: z.string().trim().min(1).max(240).optional(),
		gstin: z.string().trim().min(1).max(20).optional(),
		phone: z.string().trim().min(1).max(40).optional(),
		// R2 key (`t/{slug}/branding/logo.png`) or absolute URL. We store the
		// key when the upload comes from our own UI so we can re-presign at
		// render time; absolute URL support means a tenant can also paste a
		// CDN URL during onboarding.
		logoUrl: z.string().trim().min(1).max(500).optional(),
		accentHsl: z
			.string()
			.trim()
			.regex(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/, {
				message: "Expected an HSL triple like '221 83% 53%'",
			})
			.optional(),
	})
	.strict();

export type TenantBranding = z.infer<typeof TenantBrandingSchema>;

/**
 * Pulls the typed branding object out of the raw `tenants.settings` JSONB
 * blob. Anything that doesn't parse falls back to `{}` so a malformed
 * record never breaks receipt rendering.
 */
export function readBranding(settings: unknown): TenantBranding {
	if (!settings || typeof settings !== "object") return {};
	const branding = (settings as { branding?: unknown }).branding;
	const parsed = TenantBrandingSchema.safeParse(branding ?? {});
	return parsed.success ? parsed.data : {};
}

/**
 * Resolves the legal name shown on the receipt. Always returns a string -
 * if branding.legalName is missing we fall back to the tenant's display name.
 */
export function legalNameFor(
	settings: unknown,
	fallbackName: string,
): string {
	const b = readBranding(settings);
	return b.legalName ?? fallbackName;
}
