import { and, desc, eq, gte, lt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
	collections as collectionsTable,
	customers,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import {
	buildCollectionAuditWriter,
	CollectionCreateBody,
	createCollectionInTx,
} from "@/lib/collections/create";
import {
	badRequest,
	HttpError,
	tooMany,
	toResponse,
} from "@/lib/errors";
import { limitCollections, rateLimitHeaders } from "@/lib/rate-limit";

const ListQuery = z.object({
	customerId: z.string().uuid().optional(),
	agentId: z.string().uuid().optional(),
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
	limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const runtime = "nodejs";

function clientIp(req: NextRequest): string | null {
	return (
		req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		req.headers.get("x-real-ip") ??
		null
	);
}

// --- GET /api/collections ---------------------------------------------------

export async function GET(req: NextRequest) {
	try {
		const auth = await requireAuth();
		const url = new URL(req.url);

		const parsed = ListQuery.safeParse({
			customerId: url.searchParams.get("customerId") ?? undefined,
			agentId: url.searchParams.get("agentId") ?? undefined,
			from: url.searchParams.get("from") ?? undefined,
			to: url.searchParams.get("to") ?? undefined,
			limit: url.searchParams.get("limit") ?? undefined,
		});
		if (!parsed.success) {
			throw badRequest("Invalid query", parsed.error.flatten());
		}
		const { customerId, agentId: agentIdParam, from, to, limit } = parsed.data;

		// Agents are pinned to their own row; managers/admin/auditor can scope
		// freely within the tenant via ?agentId=.
		const effectiveAgentId =
			auth.role === "agent" ? auth.sub : agentIdParam ?? null;

		const rows = await withTenant(auth.tid, async (tx) => {
			const conds = [eq(collectionsTable.tenantId, auth.tid)];
			if (effectiveAgentId)
				conds.push(eq(collectionsTable.agentId, effectiveAgentId));
			if (customerId) conds.push(eq(collectionsTable.customerId, customerId));
			if (from) conds.push(gte(collectionsTable.collectedAt, from));
			if (to) conds.push(lt(collectionsTable.collectedAt, to));

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
				.innerJoin(
					customers,
					and(
						eq(customers.id, collectionsTable.customerId),
						eq(customers.tenantId, auth.tid),
					),
				)
				.where(and(...conds))
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

		const parsed = CollectionCreateBody.safeParse(
			await req.json().catch(() => ({})),
		);
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const data = parsed.data;

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

		const result = await withTenant(auth.tid, async (tx) =>
			createCollectionInTx(tx, {
				auth,
				agentCode: agentRow.agentCode!,
				data,
				writeAudit: buildCollectionAuditWriter({
					tenantId: auth.tid,
					actorId: agentId,
					ip: clientIp(req),
					deviceId: data.deviceId ?? null,
					userAgent: req.headers.get("user-agent"),
					tx,
				}),
			}),
		);

		const status = result.replayed ? 200 : 201;
		return NextResponse.json(
			{ collection: result.row, replayed: result.replayed },
			{ status, headers: rlHeaders },
		);
	} catch (err) {
		return toResponse(err);
	}
}
