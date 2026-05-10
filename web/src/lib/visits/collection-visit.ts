import { and, eq } from "drizzle-orm";

import { customerVisits } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";

type UpsertCollectionVisitInput = {
	tenantId: string;
	agentId: string;
	customerId: string;
	collectionId: string;
	collectedAt: Date;
};

/**
 * A successful collection is also proof that the agent visited the customer,
 * even if the foreground tracker has not accumulated enough sustained fixes
 * to derive a location-log visit yet.
 */
export async function upsertCollectionVisit(
	tx: TenantTx,
	input: UpsertCollectionVisitInput,
): Promise<boolean> {
	const existingByCollection = await tx
		.select({ id: customerVisits.id })
		.from(customerVisits)
		.where(
			and(
				eq(customerVisits.tenantId, input.tenantId),
				eq(customerVisits.collectionId, input.collectionId),
			),
		)
		.limit(1);
	if (existingByCollection[0]) return false;

	const inserted = await tx
		.insert(customerVisits)
		.values({
			tenantId: input.tenantId,
			agentId: input.agentId,
			customerId: input.customerId,
			startedAt: input.collectedAt,
			endedAt: input.collectedAt,
			dwellSeconds: 0,
			source: "collection",
			collectionId: input.collectionId,
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

	if (inserted.length > 0) return true;

	// If a row already exists for the exact timestamp (rare, but possible on
	// replay/backfill), link it to the collection so Movement can mark it as
	// collected instead of leaving the ledger/session relationship blank.
	await tx
		.update(customerVisits)
		.set({ collectionId: input.collectionId })
		.where(
			and(
				eq(customerVisits.tenantId, input.tenantId),
				eq(customerVisits.agentId, input.agentId),
				eq(customerVisits.customerId, input.customerId),
				eq(customerVisits.startedAt, input.collectedAt),
			),
		);

	return false;
}
