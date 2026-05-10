import { and, eq, sql } from "drizzle-orm";

import { locationLogs, users } from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";

/**
 * Phase 10 / Track C2 - "what's the latest fix for every agent who's
 * been on duty in the last N minutes?"
 *
 * One round-trip via `DISTINCT ON (agent_id)` against the
 * `(tenant_id, agent_id, logged_at)` index. We then resolve agent
 * display names from the auth-only `users` table in a second query
 * (RLS forbids the `vcts_app` role from reading `users` directly).
 */
export type LiveAgentLocation = {
	agentId: string;
	agentName: string;
	agentCode: string | null;
	lat: number;
	lng: number;
	accuracyM: number | null;
	batteryPct: number | null;
	loggedAt: string;
};

export async function fetchLiveAgentLocations(
	tenantId: string,
	opts: { sinceMinutes?: number } = {},
): Promise<LiveAgentLocation[]> {
	const sinceMinutes = Math.max(1, Math.min(opts.sinceMinutes ?? 30, 1440));

	type Row = {
		agent_id: string;
		lat: number;
		lng: number;
		accuracy_m: number | null;
		battery_pct: number | null;
		logged_at: Date | string;
	};
	const rows: Row[] = await withTenant(tenantId, async (tx) => {
		const result = await tx.execute<Row>(sql`
			SELECT DISTINCT ON (${locationLogs.agentId})
				${locationLogs.agentId} AS agent_id,
				${locationLogs.lat} AS lat,
				${locationLogs.lng} AS lng,
				${locationLogs.accuracyM} AS accuracy_m,
				${locationLogs.batteryPct} AS battery_pct,
				${locationLogs.loggedAt} AS logged_at
			FROM ${locationLogs}
			WHERE ${locationLogs.tenantId} = ${tenantId}
				AND ${locationLogs.loggedAt} > NOW() - (${sinceMinutes}::int * INTERVAL '1 minute')
			ORDER BY ${locationLogs.agentId}, ${locationLogs.loggedAt} DESC
		`);
		// drizzle-orm/neon-serverless wraps node-postgres - `.rows` is
		// the canonical accessor. Some other Drizzle drivers (e.g.
		// neon-http) return an array directly; cover both shapes so the
		// helper survives a future driver swap.
		const r = result as unknown;
		if (Array.isArray(r)) return r as Row[];
		if (r && typeof r === "object" && "rows" in r) {
			return (r as { rows: Row[] }).rows ?? [];
		}
		return [];
	});

	if (rows.length === 0) return [];

	const agentIds = Array.from(new Set(rows.map((r) => r.agent_id)));
	const usersRows = await withoutTenant((tx) =>
		tx
			.select({
				id: users.id,
				name: users.name,
				agentCode: users.agentCode,
			})
			.from(users)
			.where(and(eq(users.tenantId, tenantId))),
	);
	const userMap = new Map(usersRows.map((u) => [u.id, u]));

	return rows
		.filter((r) => agentIds.includes(r.agent_id))
		.map((r) => {
			const u = userMap.get(r.agent_id);
			const loggedAt =
				r.logged_at instanceof Date
					? r.logged_at.toISOString()
					: new Date(r.logged_at).toISOString();
			return {
				agentId: r.agent_id,
				agentName: u?.name ?? "Unknown",
				agentCode: u?.agentCode ?? null,
				lat: Number(r.lat),
				lng: Number(r.lng),
				accuracyM: r.accuracy_m != null ? Number(r.accuracy_m) : null,
				batteryPct: r.battery_pct,
				loggedAt,
			};
		});
}
