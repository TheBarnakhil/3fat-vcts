import { and, asc, between, eq, gte } from "drizzle-orm";

import {
	collections,
	customers,
	customerVisits,
	locationLogs,
	supervisorReviews,
	tenants,
	type CustomerVisit,
	type LocationLog,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { env } from "@/lib/env";
import { haversineMeters } from "@/lib/geo/haversine";
import { upsertCollectionVisit } from "@/lib/visits/collection-visit";

/**
 * Result of one recompute pass. The cron handler returns this verbatim
 * so the Vercel logs make it obvious what was processed.
 */
export type RecomputeStats = {
	tenantId: string;
	agentsProcessed: number;
	fixesScanned: number;
	visitsCreated: number;
	visitsSkippedDuplicate: number;
	collectionsScanned: number;
	supervisorReviewsCreated: number;
};

export type GlobalRecomputeStats = {
	startedAt: string;
	finishedAt: string;
	lookbackMinutes: number;
	totalAgentsProcessed: number;
	totalFixesScanned: number;
	totalVisitsCreated: number;
	totalSupervisorReviewsCreated: number;
	perTenant: RecomputeStats[];
};

/**
 * Configuration knobs lifted from env so tests / verify scripts can pass
 * tighter values without polluting prod tunables.
 */
export type RecomputeConfig = {
	minDwellSeconds: number;
	lookbackMinutes: number;
	collectionToleranceMin: number;
	/**
	 * Maximum gap between two consecutive in-fence fixes before we treat
	 * them as belonging to *different* visits. Defaults to 2x the tracker
	 * interval (5 min) so a single missed fix doesn't break a visit; a
	 * 12-min gap likely means the agent stepped out of the fence and
	 * back.
	 */
	maxGapSeconds: number;
};

export const DEFAULT_RECOMPUTE_CONFIG: RecomputeConfig = {
	minDwellSeconds: env.VISIT_MIN_DWELL_SECONDS,
	lookbackMinutes: env.VISIT_RECOMPUTE_LOOKBACK_MIN,
	collectionToleranceMin: env.VISIT_COLLECTION_TOLERANCE_MIN,
	maxGapSeconds: 12 * 60,
};

/**
 * Re-derive `customer_visits` rows for every tenant. Idempotent thanks
 * to the `(tenant, agent, customer, started_at)` unique index on
 * `customer_visits` and the `(tenant, collection_id, reason)` look-up on
 * `supervisor_reviews`.
 *
 * Runs in O(fixes_in_window * customers_in_tenant) which is fine for the
 * size of tenants we expect; if a tenant ever grows past ~10k customers
 * we'll need a spatial index. For now the haversine loop is bounded by
 * the cron's lookback window and is comfortably fast enough.
 */
export async function recomputeAllTenants(
	cfg: RecomputeConfig = DEFAULT_RECOMPUTE_CONFIG,
): Promise<GlobalRecomputeStats> {
	const startedAt = new Date();
	const lookbackMs = cfg.lookbackMinutes * 60 * 1000;
	const windowStart = new Date(startedAt.getTime() - lookbackMs);

	const tenantRows = await withoutTenant((tx) =>
		tx
			.select({ id: tenants.id, slug: tenants.slug })
			.from(tenants)
			.where(eq(tenants.isActive, true)),
	);

	const perTenant: RecomputeStats[] = [];
	for (const t of tenantRows) {
		const stats = await recomputeForTenant(t.id, windowStart, cfg);
		perTenant.push(stats);
	}

	return {
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		lookbackMinutes: cfg.lookbackMinutes,
		totalAgentsProcessed: perTenant.reduce((s, r) => s + r.agentsProcessed, 0),
		totalFixesScanned: perTenant.reduce((s, r) => s + r.fixesScanned, 0),
		totalVisitsCreated: perTenant.reduce((s, r) => s + r.visitsCreated, 0),
		totalSupervisorReviewsCreated: perTenant.reduce(
			(s, r) => s + r.supervisorReviewsCreated,
			0,
		),
		perTenant,
	};
}

/**
 * Single-tenant recompute. Exposed separately so the verify script can
 * exercise this without paging through every tenant.
 */
export async function recomputeForTenant(
	tenantId: string,
	windowStart: Date,
	cfg: RecomputeConfig = DEFAULT_RECOMPUTE_CONFIG,
): Promise<RecomputeStats> {
	const stats: RecomputeStats = {
		tenantId,
		agentsProcessed: 0,
		fixesScanned: 0,
		visitsCreated: 0,
		visitsSkippedDuplicate: 0,
		collectionsScanned: 0,
		supervisorReviewsCreated: 0,
	};

	await withTenant(tenantId, async (tx) => {
		// Pull customers once - this is the corpus we test each fix
		// against. A spatial index would be nicer for huge tenants but
		// haversine + small list is plenty for the seed scale.
		const customerRows = await tx
			.select({
				id: customers.id,
				lat: customers.lat,
				lng: customers.lng,
				geofenceRadiusM: customers.geofenceRadiusM,
			})
			.from(customers)
			.where(eq(customers.tenantId, tenantId));

		if (customerRows.length === 0) return;

		// Recent tracker fixes for the whole tenant, ordered by agent
		// then time so we can group cheaply in JS. Spot-fixes captured
		// at collection submit time (`source='collection'`) are excluded
		// from the visit clustering because by definition they're a
		// single in-fence sample, not sustained presence.
		const fixRows = await tx
			.select({
				id: locationLogs.id,
				agentId: locationLogs.agentId,
				lat: locationLogs.lat,
				lng: locationLogs.lng,
				loggedAt: locationLogs.loggedAt,
				source: locationLogs.source,
			})
			.from(locationLogs)
			.where(
				and(
					eq(locationLogs.tenantId, tenantId),
					gte(locationLogs.loggedAt, windowStart),
					eq(locationLogs.source, "tracker"),
				),
			)
			.orderBy(asc(locationLogs.agentId), asc(locationLogs.loggedAt));

		stats.fixesScanned = fixRows.length;

		const fixesByAgent = new Map<string, typeof fixRows>();
		for (const f of fixRows) {
			const list = fixesByAgent.get(f.agentId);
			if (list) list.push(f);
			else fixesByAgent.set(f.agentId, [f]);
		}

		stats.agentsProcessed = fixesByAgent.size;

		const recentCollections = await tx
			.select({
				id: collections.id,
				agentId: collections.agentId,
				customerId: collections.customerId,
				collectedAt: collections.collectedAt,
				receiptNo: collections.receiptNo,
				supervisorReview: collections.supervisorReview,
			})
			.from(collections)
			.where(
				and(
					eq(collections.tenantId, tenantId),
					gte(collections.collectedAt, windowStart),
				),
			);

		stats.collectionsScanned = recentCollections.length;
		const collectionLinkToleranceMs = cfg.collectionToleranceMin * 60 * 1000;

		for (const c of recentCollections) {
			const inserted = await upsertCollectionVisit(tx, {
				tenantId,
				agentId: c.agentId,
				customerId: c.customerId,
				collectionId: c.id,
				collectedAt: c.collectedAt,
			});
			if (inserted) stats.visitsCreated += 1;
			else stats.visitsSkippedDuplicate += 1;
		}

		for (const [agentId, fixes] of fixesByAgent) {
			const visits = clusterFixesIntoVisits(fixes, customerRows, cfg);
			for (const v of visits) {
				const linkWindowStart = new Date(
					v.startedAt.getTime() - collectionLinkToleranceMs,
				);
				const linkWindowEnd = new Date(
					v.endedAt.getTime() + collectionLinkToleranceMs,
				);
				const matchingCollection = recentCollections.find(
					(c) =>
						c.agentId === agentId &&
						c.customerId === v.customerId &&
						c.collectedAt >= linkWindowStart &&
						c.collectedAt <= linkWindowEnd,
				);
				if (matchingCollection) {
					const upgraded = await tx
						.update(customerVisits)
						.set({
							startedAt: v.startedAt,
							endedAt: v.endedAt,
							dwellSeconds: v.dwellSeconds,
							source: "location_logs",
						})
						.where(
							and(
								eq(customerVisits.collectionId, matchingCollection.id),
								eq(customerVisits.tenantId, tenantId),
							),
						)
						.returning({ id: customerVisits.id });
					if (upgraded.length > 0) continue;
				}
				const inserted = await tx
					.insert(customerVisits)
					.values({
						tenantId,
						customerId: v.customerId,
						agentId,
						startedAt: v.startedAt,
						endedAt: v.endedAt,
						dwellSeconds: v.dwellSeconds,
						source: "location_logs",
						collectionId: matchingCollection?.id ?? null,
					})
					.onConflictDoNothing({
						target: [
							customerVisits.tenantId,
							customerVisits.agentId,
							customerVisits.customerId,
							customerVisits.startedAt,
						],
					})
					.returning({ id: customerVisits.id });
				if (inserted.length === 0) {
					stats.visitsSkippedDuplicate += 1;
				} else {
					stats.visitsCreated += 1;
				}
			}
		}

		// --- Cross-correlate collections with the agent's recent fixes ---
		// Any collection submitted in the lookback window whose agent has
		// no fix within `collectionToleranceMin` of `collected_at` and
		// inside the customer's fence is suspicious - it might be a
		// spoofed location or a missed tracker run. We raise an
		// `unverified_visit` review row (idempotent on collection_id).
		for (const c of recentCollections) {
			// Skip rows that have already been reviewed/flagged for this
			// reason - the unique-by-(collection, reason) check below
			// handles the dedupe but skipping early avoids the lookup.
			const customerRow = customerRows.find((cr) => cr.id === c.customerId);
			if (!customerRow) continue;

			const tolMs = cfg.collectionToleranceMin * 60 * 1000;
			const fixWindowStart = new Date(c.collectedAt.getTime() - tolMs);
			const fixWindowEnd = new Date(c.collectedAt.getTime() + tolMs);

			const nearbyFixes = await tx
				.select({
					lat: locationLogs.lat,
					lng: locationLogs.lng,
				})
				.from(locationLogs)
				.where(
					and(
						eq(locationLogs.tenantId, tenantId),
						eq(locationLogs.agentId, c.agentId),
						eq(locationLogs.source, "tracker"),
						between(
							locationLogs.loggedAt,
							fixWindowStart,
							fixWindowEnd,
						),
					),
				)
				.limit(50);

			const within = nearbyFixes.some((f) => {
				const d = haversineMeters(
					{ lat: customerRow.lat, lng: customerRow.lng },
					{ lat: f.lat, lng: f.lng },
				);
				return d <= customerRow.geofenceRadiusM;
			});
			if (within) continue;

			// Idempotency: don't re-flag the same collection on every
			// cron tick. We use the supervisor_reviews table itself as
			// the dedupe (one row per collection_id+reason).
			const exists = await tx
				.select({ id: supervisorReviews.id })
				.from(supervisorReviews)
				.where(
					and(
						eq(supervisorReviews.tenantId, tenantId),
						eq(supervisorReviews.collectionId, c.id),
						eq(supervisorReviews.reason, "unverified_visit"),
					),
				)
				.limit(1);
			if (exists[0]) continue;

			await tx.insert(supervisorReviews).values({
				tenantId,
				collectionId: c.id,
				reason: "unverified_visit",
				payload: {
					receiptNo: c.receiptNo,
					collectedAt: c.collectedAt.toISOString(),
					nearbyFixCount: nearbyFixes.length,
					toleranceMinutes: cfg.collectionToleranceMin,
				},
			});
			// Also flip the collection's supervisor_review flag if it
			// wasn't already set so the manager dashboard surface picks
			// it up.
			if (!c.supervisorReview) {
				await tx
					.update(collections)
					.set({ supervisorReview: true })
					.where(
						and(
							eq(collections.id, c.id),
							eq(collections.tenantId, tenantId),
						),
					);
			}
			stats.supervisorReviewsCreated += 1;
		}
	});

	return stats;
}

type ClusteringInput = Pick<
	LocationLog,
	"id" | "lat" | "lng" | "loggedAt" | "source"
>;

type ClusteringCustomer = {
	id: string;
	lat: number;
	lng: number;
	geofenceRadiusM: number;
};

type DerivedVisit = Pick<
	CustomerVisit,
	"customerId" | "startedAt" | "endedAt" | "dwellSeconds"
>;

/**
 * Walk through one agent's fixes in chronological order, mark each fix
 * with the customer fence it falls into, and emit a [DerivedVisit] for
 * every contiguous run of in-fence fixes whose duration meets the
 * configured threshold.
 *
 * Notes:
 *   - A fix can simultaneously be inside multiple fences (overlapping
 *     stores). We pick the *closest* customer for that fix. Cleanest
 *     semantics for the manager: "the agent visited X" not "the agent
 *     was somewhere within 100m of X *and* Y".
 *   - We close the current run when the fix is out of any fence, the
 *     fence customer changes, or the gap to the next fix exceeds
 *     `maxGapSeconds`.
 */
export function clusterFixesIntoVisits(
	fixes: ClusteringInput[],
	customerCorpus: ClusteringCustomer[],
	cfg: RecomputeConfig,
): DerivedVisit[] {
	const visits: DerivedVisit[] = [];
	if (fixes.length === 0 || customerCorpus.length === 0) return visits;

	type Cluster = {
		customerId: string;
		startedAt: Date;
		endedAt: Date;
	};
	let active: Cluster | null = null;
	let lastFixAt: Date | null = null;

	const flush = () => {
		if (!active) return;
		const dwellSeconds = Math.round(
			(active.endedAt.getTime() - active.startedAt.getTime()) / 1000,
		);
		if (dwellSeconds >= cfg.minDwellSeconds) {
			visits.push({
				customerId: active.customerId,
				startedAt: active.startedAt,
				endedAt: active.endedAt,
				dwellSeconds,
			});
		}
		active = null;
	};

	for (const fix of fixes) {
		const customer = nearestCustomerFence(fix.lat, fix.lng, customerCorpus);
		const inFence = customer != null;
		const gapTooBig =
			lastFixAt != null &&
			fix.loggedAt.getTime() - lastFixAt.getTime() >
				cfg.maxGapSeconds * 1000;

		if (!inFence || gapTooBig) {
			flush();
		} else if (active && active.customerId !== customer.id) {
			flush();
		}

		if (customer && !active) {
			active = {
				customerId: customer.id,
				startedAt: fix.loggedAt,
				endedAt: fix.loggedAt,
			};
		} else if (active && customer && active.customerId === customer.id) {
			active.endedAt = fix.loggedAt;
		}

		lastFixAt = fix.loggedAt;
	}
	flush();

	return visits;
}

function nearestCustomerFence(
	lat: number,
	lng: number,
	corpus: ClusteringCustomer[],
): ClusteringCustomer | null {
	let best: ClusteringCustomer | null = null;
	let bestD = Number.POSITIVE_INFINITY;
	for (const c of corpus) {
		const d = haversineMeters({ lat: c.lat, lng: c.lng }, { lat, lng });
		if (d <= c.geofenceRadiusM && d < bestD) {
			best = c;
			bestD = d;
		}
	}
	return best;
}

