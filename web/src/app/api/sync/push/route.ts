import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { users } from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth, requireRole } from "@/lib/auth/context";
import {
	buildCollectionAuditWriter,
	CollectionCreateBody,
	createCollectionInTx,
	type CollectionCreateInput,
} from "@/lib/collections/create";
import { badRequest, HttpError, tooMany, toResponse } from "@/lib/errors";
import { limitSyncPush, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Cap the batch so a runaway client cannot wedge a Vercel function for
 * minutes. The Android queue drains in chunks of this size at most.
 */
const MAX_BATCH = 50;

const PushBody = z.object({
	records: z
		.array(CollectionCreateBody)
		.min(1, "At least one record is required")
		.max(MAX_BATCH, `Up to ${MAX_BATCH} records per request`),
});

function clientIp(req: NextRequest): string | null {
	return (
		req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		req.headers.get("x-real-ip") ??
		null
	);
}

type RecordOutcome =
	| {
			clientUuid: string;
			status: "created" | "duplicate";
			collection: { id: string; receiptNo: string };
			supervisorReview: boolean;
			replayed: boolean;
	  }
	| {
			clientUuid: string;
			status: "rejected";
			error: { code: string; message: string; details?: unknown };
	  };

/**
 * `POST /api/sync/push`
 *
 * Drains a batch of offline-recorded collections from a single agent's
 * device. Each record is processed in its own transaction so a single bad
 * row (e.g. a customer that's since been deleted, a geofence violation
 * after the agent moved) does not block the other rows in the batch.
 *
 * Idempotent on `(tenant_id, client_uuid)` - the same batch may be safely
 * retried after a network blip and duplicates collapse to `status: "duplicate"`.
 *
 * Rate limited per (tenant, agent) at 60 *requests* per minute (not per
 * record) - we want a draining client to make steady progress. The classic
 * `/api/collections` per-collection limit still applies if/when that
 * endpoint is hit directly.
 */
export async function POST(req: NextRequest) {
	try {
		const auth = await requireAuth();
		// Sync push is exclusively a field-agent path. Managers don't queue.
		requireRole(auth, "agent");

		const agentId = auth.sub;

		// Throttle the request frequency, not the per-record rate. The
		// `MAX_BATCH` cap above already constrains how many collections one
		// request can write, so 60 requests/min is plenty for a draining
		// queue while still cutting off a runaway client.
		const rl = await limitSyncPush(auth.tid, agentId);
		const rlHeaders = rateLimitHeaders(rl);
		if (!rl.success) {
			const err = tooMany(
				"Too many sync requests. The device will retry automatically.",
			);
			return NextResponse.json(
				{ error: { code: err.code, message: err.message } },
				{ status: err.status, headers: rlHeaders },
			);
		}

		const parsed = PushBody.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) {
			throw badRequest("Invalid sync push body", parsed.error.flatten());
		}
		const { records } = parsed.data;

		// Look up agent_code once - shared across all records in the batch.
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
		const agentCode = agentRow.agentCode;

		const ip = clientIp(req);
		const userAgent = req.headers.get("user-agent");

		const outcomes: RecordOutcome[] = [];
		for (const record of records) {
			outcomes.push(
				await processOne({
					auth,
					agentCode,
					data: record,
					ip,
					userAgent,
				}),
			);
		}

		const counts = summarise(outcomes);

		return NextResponse.json(
			{
				outcomes,
				counts,
			},
			{ headers: rlHeaders },
		);
	} catch (err) {
		return toResponse(err);
	}
}

async function processOne(args: {
	auth: { tid: string; tslug: string; sub: string; role: string };
	agentCode: string;
	data: CollectionCreateInput;
	ip: string | null;
	userAgent: string | null;
}): Promise<RecordOutcome> {
	const { auth, agentCode, data, ip, userAgent } = args;
	try {
		const result = await withTenant(auth.tid, async (tx) =>
			createCollectionInTx(tx, {
				auth,
				agentCode,
				data,
				writeAudit: buildCollectionAuditWriter({
					tenantId: auth.tid,
					actorId: auth.sub,
					ip,
					deviceId: data.deviceId ?? null,
					userAgent,
					tx,
				}),
			}),
		);
		return {
			clientUuid: data.clientUuid,
			status: result.replayed ? "duplicate" : "created",
			replayed: result.replayed,
			collection: { id: result.row.id, receiptNo: result.row.receiptNo },
			supervisorReview: result.row.supervisorReview,
		};
	} catch (err) {
		if (err instanceof HttpError) {
			return {
				clientUuid: data.clientUuid,
				status: "rejected",
				error: {
					code: err.code,
					message: err.message,
					details: err.details,
				},
			};
		}
		// Unexpected errors bubble - the whole batch fails with 500 so the
		// client retries the lot. Logging happens in `toResponse`.
		throw err;
	}
}

function summarise(outcomes: RecordOutcome[]) {
	let created = 0;
	let duplicate = 0;
	let rejected = 0;
	let supervisorReview = 0;
	for (const o of outcomes) {
		if (o.status === "created") {
			created += 1;
			if (o.supervisorReview) supervisorReview += 1;
		} else if (o.status === "duplicate") {
			duplicate += 1;
		} else {
			rejected += 1;
		}
	}
	return { created, duplicate, rejected, supervisorReview };
}
