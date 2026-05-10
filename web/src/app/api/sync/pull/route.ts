import { and, asc, eq, gt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { collections, customers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * Hard cap on rows per page. The Android client paginates by re-issuing the
 * request with the returned cursor; under normal conditions a tenant has
 * far fewer than 500 customers, so the first call returns everything.
 */
const PAGE_SIZE = 500;

const Query = z.object({
	since: z.coerce.date().optional(),
	scope: z.enum(["customers", "collections", "all"]).default("all"),
});

/**
 * `GET /api/sync/pull?since=<iso>&scope=all`
 *
 * Returns the slice of tenant data that has changed since the supplied
 * cursor. The Android client persists the returned `cursor` in DataStore
 * and feeds it back on the next pull, so the response is always a delta.
 *
 * Cursor semantics:
 *   - `since` is the maximum `updated_at` (customers) / `created_at`
 *     (collections) the client has already ingested.
 *   - The new `cursor` returned is the latest `updated_at`/`created_at` of
 *     anything in the response, or the original `since` if nothing changed.
 *   - Without `since` the client gets a full snapshot (used on first run
 *     and after destructive migrations).
 *
 * Agents only see collections they themselves recorded; everyone with
 * tenant access sees customers (RLS-scoped).
 */
export async function GET(req: NextRequest) {
	try {
		const auth = await requireAuth();
		const url = new URL(req.url);

		const parsed = Query.safeParse({
			since: url.searchParams.get("since") ?? undefined,
			scope: url.searchParams.get("scope") ?? undefined,
		});
		if (!parsed.success) {
			throw badRequest("Invalid query", parsed.error.flatten());
		}
		const { since, scope } = parsed.data;

		const wantCustomers = scope === "all" || scope === "customers";
		const wantCollections = scope === "all" || scope === "collections";

		const result = await withTenant(auth.tid, async (tx) => {
			const customerConds = [eq(customers.tenantId, auth.tid)];
			if (since) customerConds.push(gt(customers.updatedAt, since));
			if (auth.role === "agent")
				customerConds.push(eq(customers.assignedAgentId, auth.sub));

			const customersOut = wantCustomers
				? await tx
						.select({
							id: customers.id,
							code: customers.code,
							name: customers.name,
							address: customers.address,
							phone: customers.phone,
							email: customers.email,
							category: customers.category,
							lat: customers.lat,
							lng: customers.lng,
							geofenceRadiusM: customers.geofenceRadiusM,
							outstandingBalance: customers.outstandingBalance,
							creditLimit: customers.creditLimit,
							isOverdue: customers.isOverdue,
							assignedAgentId: customers.assignedAgentId,
							updatedAt: customers.updatedAt,
						})
						.from(customers)
						.where(customerConds.length ? and(...customerConds) : undefined)
						.orderBy(asc(customers.updatedAt))
						.limit(PAGE_SIZE)
				: [];

			// Agents are restricted to their own collections; everyone else
			// (manager / super_admin / auditor) gets the full tenant slice
			// because they manage drift across the team.
			const collectionsConds = [eq(collections.tenantId, auth.tid)];
			if (since) collectionsConds.push(gt(collections.createdAt, since));
			if (auth.role === "agent")
				collectionsConds.push(eq(collections.agentId, auth.sub));

			const collectionsOut = wantCollections
				? await tx
						.select({
							id: collections.id,
							clientUuid: collections.clientUuid,
							customerId: collections.customerId,
							agentId: collections.agentId,
							amount: collections.amount,
							paymentMode: collections.paymentMode,
							refNo: collections.refNo,
							chequeDate: collections.chequeDate,
							remarks: collections.remarks,
							collectionLat: collections.collectionLat,
							collectionLng: collections.collectionLng,
							gpsAccuracyM: collections.gpsAccuracyM,
							collectedAt: collections.collectedAt,
							receiptNo: collections.receiptNo,
							supervisorReview: collections.supervisorReview,
							syncStatus: collections.syncStatus,
							createdAt: collections.createdAt,
							photoUrl: collections.photoUrl,
							signatureUrl: collections.signatureUrl,
						})
						.from(collections)
						.where(and(...collectionsConds))
						.orderBy(asc(collections.createdAt))
						.limit(PAGE_SIZE)
				: [];

			return { customersOut, collectionsOut };
		});

		// Cursor is the highest timestamp seen in this response. If nothing
		// changed we echo `since` (or "epoch") so the client never moves
		// backwards. The client should keep calling /sync/pull until the
		// returned cursor stops advancing.
		const lastCustomer = lastTimestamp(
			result.customersOut.map((c) => c.updatedAt),
		);
		const lastCollection = lastTimestamp(
			result.collectionsOut.map((c) => c.createdAt),
		);
		const cursor = maxDate(
			since ?? new Date(0),
			lastCustomer,
			lastCollection,
		).toISOString();

		const hasMore =
			result.customersOut.length === PAGE_SIZE ||
			result.collectionsOut.length === PAGE_SIZE;

		return NextResponse.json({
			cursor,
			hasMore,
			customers: result.customersOut,
			collections: result.collectionsOut,
		});
	} catch (err) {
		return toResponse(err);
	}
}

function lastTimestamp(dates: Array<Date | null>): Date {
	let max = new Date(0);
	for (const d of dates) {
		if (d && d.getTime() > max.getTime()) max = d;
	}
	return max;
}

function maxDate(...dates: Date[]): Date {
	let max = dates[0];
	for (const d of dates) {
		if (d.getTime() > max.getTime()) max = d;
	}
	return max;
}
