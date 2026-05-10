import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { tenants } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, notFound, toResponse } from "@/lib/errors";
import { TenantBrandingSchema, readBranding } from "@/lib/tenants/branding";
import {
	TenantGeofenceSettingsSchema,
	TenantSyncSettingsSchema,
	readGeofenceSettings,
	readSyncSettings,
} from "@/lib/tenants/settings";

export const runtime = "nodejs";

/**
 * Phase 8 - super_admin / manager view of "your tenant" with the
 * branding block exposed. We deliberately go through `withoutTenant`
 * because `tenants` carries no RLS (it's the root of multi-tenancy
 * itself) and we filter explicitly on `auth.tid`.
 */
export async function GET() {
	try {
		const auth = await requireAuth();
		const [row] = await withoutTenant(async (tx) =>
			tx
				.select({
					id: tenants.id,
					slug: tenants.slug,
					name: tenants.name,
					settings: tenants.settings,
				})
				.from(tenants)
				.where(eq(tenants.id, auth.tid))
				.limit(1),
		);
		if (!row) throw notFound("Tenant not found");
		return NextResponse.json({
			tenant: {
				id: row.id,
				slug: row.slug,
				name: row.name,
				branding: readBranding(row.settings),
				geofence: readGeofenceSettings(row.settings),
				sync: readSyncSettings(row.settings),
			},
		});
	} catch (err) {
		return toResponse(err);
	}
}

const PatchBody = z.object({
	branding: TenantBrandingSchema.optional(),
	geofence: TenantGeofenceSettingsSchema.optional(),
	sync: TenantSyncSettingsSchema.optional(),
});

export async function PATCH(req: NextRequest) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin");
		const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) {
			throw badRequest("Invalid body", parsed.error.flatten());
		}
		if (!parsed.data.branding && !parsed.data.geofence && !parsed.data.sync) {
			throw badRequest("No tenant settings supplied");
		}

		const updated = await withoutTenant(async (tx) => {
			const [row] = await tx
				.select({ id: tenants.id, settings: tenants.settings })
				.from(tenants)
				.where(eq(tenants.id, auth.tid))
				.limit(1);
			if (!row) throw notFound("Tenant not found");

			const before = {
				branding: readBranding(row.settings),
				geofence: readGeofenceSettings(row.settings),
				sync: readSyncSettings(row.settings),
			};
			const nextSettings = (row.settings as Record<string, unknown>) ?? {};
			const merged = {
				...nextSettings,
				...(parsed.data.branding ? { branding: parsed.data.branding } : {}),
				...(parsed.data.geofence ? { geofence: parsed.data.geofence } : {}),
				...(parsed.data.sync ? { sync: parsed.data.sync } : {}),
			};
			const [next] = await tx
				.update(tenants)
				.set({ settings: merged, updatedAt: new Date() })
				.where(eq(tenants.id, auth.tid))
				.returning({
					id: tenants.id,
					slug: tenants.slug,
					name: tenants.name,
					settings: tenants.settings,
				});

			await appendAudit(tx, {
				tenantId: auth.tid,
				actorId: auth.sub,
				action: "tenant.settings_updated",
				entityType: "tenant",
				entityId: auth.tid,
				before,
				after: {
					...(parsed.data.branding ? { branding: parsed.data.branding } : {}),
					...(parsed.data.geofence ? { geofence: parsed.data.geofence } : {}),
					...(parsed.data.sync ? { sync: parsed.data.sync } : {}),
				},
			});

			return next;
		});

		return NextResponse.json({
			tenant: {
				id: updated.id,
				slug: updated.slug,
				name: updated.name,
				branding: readBranding(updated.settings),
					geofence: readGeofenceSettings(updated.settings),
					sync: readSyncSettings(updated.settings),
			},
		});
	} catch (err) {
		return toResponse(err);
	}
}
