import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
	collections as collectionsTable,
	customers,
	supervisorReviews,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { env } from "@/lib/env";
import { forbidden, HttpError, notFound } from "@/lib/errors";
import { haversineMeters } from "@/lib/geo/haversine";
import {
	fiscalYearForDate,
	formatReceiptNo,
} from "@/lib/receipts/format";

/**
 * Shared schema used by both `POST /api/collections` (single) and
 * `POST /api/sync/push` (batched offline replay). Every field is also
 * mirrored in the Android `CollectionCreateBody` DTO.
 */
export const CollectionCreateBody = z.object({
	clientUuid: z.string().uuid(),
	customerId: z.string().uuid(),
	amount: z.number().positive().finite(),
	paymentMode: z.enum(["cash", "cheque", "bank_transfer", "upi"]),
	refNo: z.string().max(64).optional().nullable(),
	chequeDate: z.coerce.date().optional().nullable(),
	remarks: z.string().max(500).optional().nullable(),
	collectionLat: z.number().gte(-90).lte(90),
	collectionLng: z.number().gte(-180).lte(180),
	gpsAccuracyM: z.number().nonnegative().optional().nullable(),
	collectedAt: z.coerce.date().optional(),
	deviceId: z.string().max(128).optional().nullable(),
	// New in Phase 6: outstanding balance the device believed the customer
	// had at submit time. Optional so older clients keep working; when
	// present it powers the >10% drift check that flags supervisor reviews.
	lastKnownOutstanding: z.number().finite().optional().nullable(),
});

export type CollectionCreateInput = z.infer<typeof CollectionCreateBody>;

export type AuditWriter = (params: {
	collectionId: string;
	receiptNo: string;
	row: typeof collectionsTable.$inferSelect;
	distanceM: number;
	allowedM: number;
	supervisorReason: string | null;
}) => Promise<void>;

export type CreateOutcome = {
	row: typeof collectionsTable.$inferSelect;
	replayed: boolean;
	distanceM: number;
	allowedM: number;
	supervisorReason: string | null;
};

/**
 * Threshold above which a balance discrepancy between the agent's last-known
 * outstanding and the server's current outstanding triggers a supervisor
 * review row. 10% mirrors the project plan.
 */
const BALANCE_DRIFT_THRESHOLD = 0.1;

/**
 * Core "insert one collection" routine. Pure of HTTP concerns; the caller
 * owns the transaction (`withTenant`) so a single `POST /api/sync/push`
 * batch can run each record in its own transaction without coupling
 * outcomes.
 *
 * Throws `HttpError` for client-correctable problems
 * (geofence_violation, not_found, forbidden, gps_accuracy_too_low,
 * agent_code_missing). Idempotent on `(tenant_id, client_uuid)`.
 */
export async function createCollectionInTx(
	tx: TenantTx,
	params: {
		auth: { tid: string; tslug: string; sub: string; role: string };
		agentCode: string;
		data: CollectionCreateInput;
		writeAudit: AuditWriter;
	},
): Promise<CreateOutcome> {
	const { auth, agentCode, data, writeAudit } = params;
	const agentId = auth.sub;

	if (
		data.gpsAccuracyM != null &&
		data.gpsAccuracyM > env.GPS_MAX_ACCURACY_M
	) {
		throw new HttpError(
			422,
			"gps_accuracy_too_low",
			`GPS accuracy ${data.gpsAccuracyM.toFixed(0)}m exceeds limit ${env.GPS_MAX_ACCURACY_M}m`,
			{ accuracyM: data.gpsAccuracyM, allowedM: env.GPS_MAX_ACCURACY_M },
		);
	}

	const collectedAt = data.collectedAt ?? new Date();
	const fy = fiscalYearForDate(collectedAt);

	// --- Idempotency: replay if (tenant, client_uuid) already exists -------
	const existing = await tx
		.select()
		.from(collectionsTable)
		.where(eq(collectionsTable.clientUuid, data.clientUuid))
		.limit(1);
	if (existing[0]) {
		return {
			row: existing[0],
			replayed: true,
			// We don't recompute distance for replays - the original row
			// already captured everything that mattered.
			distanceM: 0,
			allowedM: 0,
			supervisorReason: null,
		};
	}

	// --- Customer (RLS-filtered to the tenant) -----------------------------
	const [cust] = await tx
		.select()
		.from(customers)
		.where(eq(customers.id, data.customerId))
		.limit(1);
	if (!cust) throw notFound("Customer not found in this tenant");

	if (
		auth.role === "agent" &&
		cust.assignedAgentId &&
		cust.assignedAgentId !== agentId
	) {
		throw forbidden("This customer is not assigned to you");
	}

	// --- Server-side geofence ---------------------------------------------
	const distanceM = haversineMeters(
		{ lat: cust.lat, lng: cust.lng },
		{ lat: data.collectionLat, lng: data.collectionLng },
	);
	if (distanceM > cust.geofenceRadiusM) {
		throw new HttpError(
			422,
			"geofence_violation",
			`Collection point is ${distanceM.toFixed(0)}m from the registered customer location; allowed radius is ${cust.geofenceRadiusM}m.`,
			{
				distanceM: Math.round(distanceM),
				allowedM: cust.geofenceRadiusM,
			},
		);
	}

	// --- Atomic per-tenant + per-agent + per-FY sequence -------------------
	const seqResult = await tx.execute(
		sql`SELECT next_receipt_seq(${auth.tid}::uuid, ${agentId}::uuid, ${fy.fyStart}::int) AS seq`,
	);
	const seqRows =
		(seqResult as unknown as { rows?: Array<{ seq: number }> }).rows ??
		(seqResult as unknown as Array<{ seq: number }>);
	const seqRow = Array.isArray(seqRows) ? seqRows[0] : undefined;
	if (!seqRow || seqRow.seq == null) {
		throw new HttpError(
			500,
			"internal_error",
			"Failed to allocate receipt sequence",
		);
	}

	const receiptNo = formatReceiptNo({
		tenantSlug: auth.tslug,
		agentCode,
		fyLabel: fy.label,
		seq: Number(seqRow.seq),
	});

	// --- Drift detection ---------------------------------------------------
	// If the agent's device thought the customer owed materially less or
	// more than the server currently shows, accept the collection but flag
	// it for supervisor review. We keep the row regardless because rejecting
	// the agent's good-faith submission would be far worse UX.
	let supervisorReason: string | null = null;
	if (
		data.lastKnownOutstanding != null &&
		Number.isFinite(data.lastKnownOutstanding) &&
		Math.abs(cust.outstandingBalance) > 0
	) {
		const delta = Math.abs(
			cust.outstandingBalance - data.lastKnownOutstanding,
		);
		const ratio = delta / Math.max(1, Math.abs(cust.outstandingBalance));
		if (ratio > BALANCE_DRIFT_THRESHOLD) {
			supervisorReason = "balance_drift";
		}
	}

	// --- Insert collection -------------------------------------------------
	const [row] = await tx
		.insert(collectionsTable)
		.values({
			tenantId: auth.tid,
			clientUuid: data.clientUuid,
			customerId: data.customerId,
			agentId,
			amount: data.amount,
			paymentMode: data.paymentMode,
			refNo: data.refNo ?? null,
			chequeDate: data.chequeDate ?? null,
			remarks: data.remarks ?? null,
			collectionLat: data.collectionLat,
			collectionLng: data.collectionLng,
			gpsAccuracyM: data.gpsAccuracyM ?? null,
			collectedAt,
			receiptNo,
			deviceId: data.deviceId ?? null,
			syncStatus: "synced",
			supervisorReview: supervisorReason !== null,
			lastKnownOutstanding: data.lastKnownOutstanding ?? null,
		})
		.returning();

	// --- Bookkeeping: outstanding balance ----------------------------------
	await tx
		.update(customers)
		.set({
			outstandingBalance: sql`${customers.outstandingBalance} - ${data.amount}`,
			updatedAt: new Date(),
		})
		.where(eq(customers.id, data.customerId));

	// --- Supervisor review row (one per drift event) -----------------------
	if (supervisorReason) {
		await tx.insert(supervisorReviews).values({
			tenantId: auth.tid,
			collectionId: row.id,
			reason: supervisorReason,
			payload: {
				clientOutstanding: data.lastKnownOutstanding,
				serverOutstanding: cust.outstandingBalance,
				amount: data.amount,
				receiptNo,
			},
		});
	}

	await writeAudit({
		collectionId: row.id,
		receiptNo,
		row,
		distanceM,
		allowedM: cust.geofenceRadiusM,
		supervisorReason,
	});

	return {
		row,
		replayed: false,
		distanceM,
		allowedM: cust.geofenceRadiusM,
		supervisorReason,
	};
}

/**
 * Helper that wraps `appendAudit` with the canonical `collection.create`
 * payload shape so both the single-write and batch-push paths produce
 * identical audit rows.
 */
export function buildCollectionAuditWriter(opts: {
	tenantId: string;
	actorId: string;
	ip: string | null;
	deviceId: string | null;
	userAgent: string | null;
	tx: TenantTx;
}): AuditWriter {
	return async ({ row, distanceM, allowedM, supervisorReason }) => {
		await appendAudit(opts.tx, {
			tenantId: opts.tenantId,
			actorId: opts.actorId,
			action: "collection.create",
			entityType: "collection",
			entityId: row.id,
			after: {
				receiptNo: row.receiptNo,
				customerId: row.customerId,
				amount: row.amount,
				paymentMode: row.paymentMode,
				lat: row.collectionLat,
				lng: row.collectionLng,
				distanceM: Math.round(distanceM),
				allowedM,
				supervisorReason,
			},
			ip: opts.ip,
			deviceId: opts.deviceId,
			userAgent: opts.userAgent,
		});
	};
}
