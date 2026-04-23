import { createHmac } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { auditTrail } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { env } from "../env";

export type AuditInput = {
	tenantId: string;
	actorId: string | null;
	action: string;
	entityType: string;
	entityId?: string | null;
	before?: unknown;
	after?: unknown;
	ip?: string | null;
	deviceId?: string | null;
	userAgent?: string | null;
};

/**
 * Stable JSON stringifier: sorts object keys alphabetically at every depth
 * so the output is identical regardless of insertion order. We need this
 * because Postgres `jsonb` does not preserve key order, so before/after
 * payloads come back with a different enumeration order than they went in.
 */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((v) => stableStringify(v)).join(",")}]`;
	}
	const keys = Object.keys(value as Record<string, unknown>).sort();
	const parts = keys.map(
		(k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
	);
	return `{${parts.join(",")}}`;
}

/**
 * Canonical string we sign. Field order matters: any change invalidates the
 * chain, so edit with care. Timestamp is NOT part of the signed payload
 * because DB NOW() happens after signing; we sign over the content that
 * identifies the action.
 */
function canonicalise(
	input: AuditInput & { seq: number; prevHmac: string | null },
): string {
	return stableStringify([
		input.tenantId,
		input.seq,
		input.prevHmac ?? "",
		input.actorId ?? "",
		input.action,
		input.entityType,
		input.entityId ?? "",
		input.before ?? null,
		input.after ?? null,
		input.ip ?? "",
		input.deviceId ?? "",
		input.userAgent ?? "",
	]);
}

function sign(canonical: string): string {
	return createHmac("sha256", env.AUDIT_HMAC_SECRET).update(canonical).digest("hex");
}

/**
 * Append one row to the tenant's audit chain. MUST be called inside a
 * withTenant() transaction. The read-then-write is serialisable because we
 * select the last row FOR UPDATE, blocking concurrent audit appends on the
 * same tenant.
 */
export async function appendAudit(
	tx: TenantTx,
	input: AuditInput,
): Promise<{ seq: number; hmac: string }> {
	const prev = await tx
		.select({ seq: auditTrail.seq, hmac: auditTrail.hmac })
		.from(auditTrail)
		.where(eq(auditTrail.tenantId, input.tenantId))
		.orderBy(desc(auditTrail.seq))
		.limit(1)
		.for("update");

	const prevSeq = prev[0]?.seq ?? 0;
	const prevHmac = prev[0]?.hmac ?? null;
	const seq = prevSeq + 1;

	const hmac = sign(canonicalise({ ...input, seq, prevHmac }));

	await tx.insert(auditTrail).values({
		tenantId: input.tenantId,
		seq,
		actorId: input.actorId,
		action: input.action,
		entityType: input.entityType,
		entityId: input.entityId ?? null,
		beforeJson: input.before ?? null,
		afterJson: input.after ?? null,
		ip: input.ip ?? null,
		deviceId: input.deviceId ?? null,
		userAgent: input.userAgent ?? null,
		prevHmac,
		hmac,
	});

	return { seq, hmac };
}

/**
 * Walk the entire chain for a tenant, recomputing HMACs and returning the
 * first index where the chain is broken (or null if intact). Used by the
 * /api/audit-trail integrity endpoint and by tests.
 */
export async function verifyChain(
	tx: TenantTx,
	tenantId: string,
): Promise<
	| { ok: true; rows: number }
	| { ok: false; rows: number; brokenAtSeq: number; reason: string }
> {
	const rows = await tx
		.select()
		.from(auditTrail)
		.where(eq(auditTrail.tenantId, tenantId))
		.orderBy(auditTrail.seq);

	let expectedPrev: string | null = null;
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (row.seq !== i + 1) {
			return {
				ok: false,
				rows: rows.length,
				brokenAtSeq: row.seq,
				reason: `gap in seq; expected ${i + 1}, got ${row.seq}`,
			};
		}
		if ((row.prevHmac ?? null) !== expectedPrev) {
			return {
				ok: false,
				rows: rows.length,
				brokenAtSeq: row.seq,
				reason: "prev_hmac mismatch",
			};
		}
		const expected = sign(
			canonicalise({
				tenantId: row.tenantId,
				seq: row.seq,
				prevHmac: row.prevHmac,
				actorId: row.actorId,
				action: row.action,
				entityType: row.entityType,
				entityId: row.entityId ?? undefined,
				before: row.beforeJson,
				after: row.afterJson,
				ip: row.ip,
				deviceId: row.deviceId,
				userAgent: row.userAgent,
			}),
		);
		if (expected !== row.hmac) {
			return {
				ok: false,
				rows: rows.length,
				brokenAtSeq: row.seq,
				reason: "hmac mismatch - row was tampered",
			};
		}
		expectedPrev = row.hmac;
	}

	return { ok: true, rows: rows.length };
}
