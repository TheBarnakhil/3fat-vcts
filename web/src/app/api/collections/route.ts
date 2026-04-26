import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
	collections as collectionsTable,
	customers,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { env } from "@/lib/env";
import {
	badRequest,
	forbidden,
	HttpError,
	notFound,
	tooMany,
	toResponse,
} from "@/lib/errors";
import { haversineMeters } from "@/lib/geo/haversine";
import { limitCollections, rateLimitHeaders } from "@/lib/rate-limit";
import {
	fiscalYearForDate,
	formatReceiptNo,
} from "@/lib/receipts/format";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string | null {
	return (
		req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		req.headers.get("x-real-ip") ??
		null
	);
}

const CreateBody = z.object({
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
});

// --- GET /api/collections ---------------------------------------------------

export async function GET(req: NextRequest) {
	try {
		const auth = await requireAuth();
		const url = new URL(req.url);

		const customerId = url.searchParams.get("customerId");
		const agentIdParam = url.searchParams.get("agentId");
		const from = url.searchParams.get("from");
		const to = url.searchParams.get("to");
		const limitRaw = Number(url.searchParams.get("limit") ?? 100);
		const limit = Math.min(
			500,
			Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 100),
		);

		// Agents are pinned to their own row; managers/admin/auditor can scope
		// freely within the tenant via ?agentId=.
		const effectiveAgentId =
			auth.role === "agent" ? auth.sub : agentIdParam || null;

		const rows = await withTenant(auth.tid, async (tx) => {
			const conds = [];
			if (effectiveAgentId)
				conds.push(eq(collectionsTable.agentId, effectiveAgentId));
			if (customerId) conds.push(eq(collectionsTable.customerId, customerId));
			if (from) conds.push(gte(collectionsTable.collectedAt, new Date(from)));
			if (to) conds.push(lt(collectionsTable.collectedAt, new Date(to)));

			return tx
				.select({
					id: collectionsTable.id,
					receiptNo: collectionsTable.receiptNo,
					amount: collectionsTable.amount,
					paymentMode: collectionsTable.paymentMode,
					refNo: collectionsTable.refNo,
					customerId: collectionsTable.customerId,
					customerName: customers.name,
					customerCode: customers.code,
					agentId: collectionsTable.agentId,
					collectionLat: collectionsTable.collectionLat,
					collectionLng: collectionsTable.collectionLng,
					gpsAccuracyM: collectionsTable.gpsAccuracyM,
					collectedAt: collectionsTable.collectedAt,
					supervisorReview: collectionsTable.supervisorReview,
					createdAt: collectionsTable.createdAt,
				})
				.from(collectionsTable)
				.innerJoin(customers, eq(customers.id, collectionsTable.customerId))
				.where(conds.length ? and(...conds) : undefined)
				.orderBy(desc(collectionsTable.collectedAt))
				.limit(limit);
		});

		// Resolve agent names via the auth-only `users` table in a single
		// follow-up query (vcts_app has no SELECT on users; this runs as the
		// owner with explicit tenant filtering).
		const agentIds = Array.from(new Set(rows.map((r) => r.agentId)));
		const agentsById = new Map<
			string,
			{ name: string; agentCode: string | null }
		>();
		if (agentIds.length > 0) {
			const userRows = await withoutTenant(async (tx) =>
				tx
					.select({
						id: users.id,
						name: users.name,
						agentCode: users.agentCode,
					})
					.from(users)
					.where(and(eq(users.tenantId, auth.tid))),
			);
			for (const u of userRows) agentsById.set(u.id, u);
		}

		const enriched = rows.map((r) => ({
			...r,
			agentName: agentsById.get(r.agentId)?.name ?? null,
			agentCode: agentsById.get(r.agentId)?.agentCode ?? null,
		}));

		return NextResponse.json({ collections: enriched });
	} catch (err) {
		return toResponse(err);
	}
}

// --- POST /api/collections --------------------------------------------------

export async function POST(req: NextRequest) {
	try {
		const auth = await requireAuth();
		// Auditors are read-only; super_admins can fill in manually but the
		// expected actor is an agent or a manager covering for one.
		requireRole(auth, "agent", "manager", "super_admin");

		const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const data = parsed.data;

		// GPS accuracy gate: store the fix but reject obviously bad ones.
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

		const agentId = auth.sub;

		// --- Rate limit (per tenant + agent) -------------------------------
		const rl = await limitCollections(auth.tid, agentId);
		const rlHeaders = rateLimitHeaders(rl);
		if (!rl.success) {
			const err = tooMany(
				"Too many collections in the last minute. Try again shortly.",
			);
			return NextResponse.json(
				{ error: { code: err.code, message: err.message } },
				{ status: err.status, headers: rlHeaders },
			);
		}

		const collectedAt = data.collectedAt ?? new Date();
		const fy = fiscalYearForDate(collectedAt);

		// Pre-fetch agent_code from the auth-only `users` table. vcts_app has
		// no SELECT on users (RLS would happily scope us to the right tenant
		// but the privilege check fails first), so we hop through the owner
		// connection with explicit tenantId filtering.
		const [agentRow] = await withoutTenant(async (tx) =>
			tx
				.select({ agentCode: users.agentCode })
				.from(users)
				.where(and(eq(users.id, agentId), eq(users.tenantId, auth.tid)))
				.limit(1),
		);
		if (!agentRow?.agentCode) {
			throw new HttpError(
				422,
				"agent_code_missing",
				"This user has no agent code; ask an admin to assign one before logging collections.",
			);
		}

		const result = await withTenant(auth.tid, async (tx) => {
			// --- Idempotency: replay if (tenant, client_uuid) already exists -
			const existing = await tx
				.select()
				.from(collectionsTable)
				.where(eq(collectionsTable.clientUuid, data.clientUuid))
				.limit(1);
			if (existing[0]) {
				return { row: existing[0], replayed: true } as const;
			}

			// --- Customer (RLS-filtered to the tenant) -----------------------
			const [cust] = await tx
				.select()
				.from(customers)
				.where(eq(customers.id, data.customerId))
				.limit(1);
			if (!cust) throw notFound("Customer not found in this tenant");

			// Agents may only collect from customers assigned to them.
			if (
				auth.role === "agent" &&
				cust.assignedAgentId &&
				cust.assignedAgentId !== agentId
			) {
				throw forbidden("This customer is not assigned to you");
			}

			// --- Server-side geofence ---------------------------------------
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

			// --- Atomic per-tenant + per-agent + per-FY sequence ------------
			// next_receipt_seq() is a SECURITY DEFINER fn that asserts the
			// caller's app.tenant_id matches; see scripts/apply-rls.ts.
			const seqResult = await tx.execute(
				sql`SELECT next_receipt_seq(${auth.tid}::uuid, ${agentId}::uuid, ${fy.fyStart}::int) AS seq`,
			);
			const seqRows = (seqResult as unknown as { rows?: Array<{ seq: number }> })
				.rows ?? (seqResult as unknown as Array<{ seq: number }>);
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
				agentCode: agentRow.agentCode!,
				fyLabel: fy.label,
				seq: Number(seqRow.seq),
			});

			// --- Insert collection ------------------------------------------
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
				})
				.returning();

			// --- Bookkeeping: outstanding balance ---------------------------
			await tx
				.update(customers)
				.set({
					outstandingBalance: sql`${customers.outstandingBalance} - ${data.amount}`,
					updatedAt: new Date(),
				})
				.where(eq(customers.id, data.customerId));

			// --- Audit chain row --------------------------------------------
			await appendAudit(tx, {
				tenantId: auth.tid,
				actorId: agentId,
				action: "collection.create",
				entityType: "collection",
				entityId: row.id,
				after: {
					receiptNo,
					customerId: row.customerId,
					amount: row.amount,
					paymentMode: row.paymentMode,
					lat: row.collectionLat,
					lng: row.collectionLng,
					distanceM: Math.round(distanceM),
					allowedM: cust.geofenceRadiusM,
				},
				ip: clientIp(req),
				deviceId: data.deviceId ?? null,
				userAgent: req.headers.get("user-agent"),
			});

			return { row, replayed: false } as const;
		});

		const status = result.replayed ? 200 : 201;
		return NextResponse.json(
			{ collection: result.row, replayed: result.replayed },
			{ status, headers: rlHeaders },
		);
	} catch (err) {
		return toResponse(err);
	}
}
