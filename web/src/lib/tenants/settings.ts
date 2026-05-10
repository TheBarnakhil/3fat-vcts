import { z } from "zod";

export const TenantGeofenceSettingsSchema = z
	.object({
		defaultRadiusM: z.coerce.number().int().min(50).max(500).default(100),
		minAccuracyM: z.coerce.number().min(5).max(500).default(50),
	})
	.strict();

export const TenantSyncSettingsSchema = z
	.object({
		intervalMin: z.coerce.number().int().min(5).max(120).default(15),
	})
	.strict();

export type TenantGeofenceSettings = z.infer<typeof TenantGeofenceSettingsSchema>;
export type TenantSyncSettings = z.infer<typeof TenantSyncSettingsSchema>;

export function readGeofenceSettings(settings: unknown): TenantGeofenceSettings {
	const raw =
		settings && typeof settings === "object"
			? (settings as { geofence?: unknown }).geofence
			: undefined;
	const parsed = TenantGeofenceSettingsSchema.safeParse(raw ?? {});
	return parsed.success
		? parsed.data
		: TenantGeofenceSettingsSchema.parse({});
}

export function readSyncSettings(settings: unknown): TenantSyncSettings {
	const raw =
		settings && typeof settings === "object"
			? (settings as { sync?: unknown }).sync
			: undefined;
	const parsed = TenantSyncSettingsSchema.safeParse(raw ?? {});
	return parsed.success ? parsed.data : TenantSyncSettingsSchema.parse({});
}
