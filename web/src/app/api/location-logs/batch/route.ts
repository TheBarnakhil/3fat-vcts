import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { locationLogs } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * Cap the batch so a runaway client cannot wedge a Vercel function. The
 * Android tracker drains in chunks of this size at most.
 */
const MAX_BATCH = 200;

const LogEntry = z.object({
	clientUuid: z.string().uuid(),
	lat: z.number().gte(-90).lte(90),
	lng: z.number().gte(-180).lte(180),
	accuracyM: z.number().nonnegative().max(10_000).optional().nullable(),
	batteryPct: z.number().int().min(0).max(100).optional().nullable(),
	loggedAt: z.coerce.date(),
	source: z.enum(["tracker", "collection"]).default("tracker"),
});

const BatchBody = z.object({
	logs: z
		.array(LogEntry)
		.min(1, "At least one log is required")
		.max(MAX_BATCH, `Up to ${MAX_BATCH} logs per request`),
});

type LogOutcome = {
	clientUuid: string;
	status: "created" | "duplicate";
};

/**
 * `POST /api/location-logs/batch`
 *
 * Accepts a batch of GPS fixes recorded by the agent's foreground tracker
 * service. Idempotent on `(tenant_id, agent_id, client_uuid)` so a retry
 * after a network blip collapses against the original write.
 *
 * The Android client retries with the same payload bytes on a transport
 * failure; we use ON CONFLICT DO NOTHING and report duplicates explicitly
 * so the device can mark them synced and stop trying.
 *
 * Agent role only - managers don't have devices that emit fixes. Other
 * roles get a 403 to avoid leaking the surface area.
 */
export async function POST(req: NextRequest) {
	try {
		const auth = await requireAuth();
		requireRole(auth, "agent");

		const parsed = BatchBody.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) {
			throw badRequest("Invalid batch body", parsed.error.flatten());
		}
		const { logs } = parsed.data;

		const outcomes = await withTenant(auth.tid, async (tx) => {
			const rows = logs.map((l) => ({
				tenantId: auth.tid,
				agentId: auth.sub,
				clientUuid: l.clientUuid,
				lat: l.lat,
				lng: l.lng,
				accuracyM: l.accuracyM ?? null,
				batteryPct: l.batteryPct ?? null,
				source: l.source,
				loggedAt: l.loggedAt,
			}));

			// Insert all rows in one statement, swallowing duplicates so the
			// surviving set is exactly the newly-created rows. We then
			// compare against the input to compute per-record outcomes.
			const inserted = await tx
				.insert(locationLogs)
				.values(rows)
				.onConflictDoNothing({
					target: [
						locationLogs.tenantId,
						locationLogs.agentId,
						locationLogs.clientUuid,
					],
				})
				.returning({ clientUuid: locationLogs.clientUuid });

			const createdSet = new Set(inserted.map((r) => r.clientUuid));
			const out: LogOutcome[] = logs.map((l) => ({
				clientUuid: l.clientUuid,
				status: createdSet.has(l.clientUuid) ? "created" : "duplicate",
			}));
			return out;
		});

		const counts = outcomes.reduce(
			(acc, o) => {
				if (o.status === "created") acc.created += 1;
				else acc.duplicate += 1;
				return acc;
			},
			{ created: 0, duplicate: 0 },
		);

		return NextResponse.json({ outcomes, counts });
	} catch (err) {
		return toResponse(err);
	}
}
