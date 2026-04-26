import { and, desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import {
	collectionReversals,
	collections as collectionsTable,
	customers,
	users,
} from "@/db/schema";
import { withoutTenant, withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { forbidden, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(
	_req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		const auth = await requireAuth();
		const { id } = await ctx.params;

		const data = await withTenant(auth.tid, async (tx) => {
			const [row] = await tx
				.select({
					collection: collectionsTable,
					customerName: customers.name,
					customerCode: customers.code,
					customerAddress: customers.address,
					customerPhone: customers.phone,
				})
				.from(collectionsTable)
				.innerJoin(customers, eq(customers.id, collectionsTable.customerId))
				.where(eq(collectionsTable.id, id))
				.limit(1);
			if (!row) return null;

			const reversals = await tx
				.select()
				.from(collectionReversals)
				.where(eq(collectionReversals.originalCollectionId, id))
				.orderBy(desc(collectionReversals.reversedAt));

			return { ...row, reversals };
		});

		if (!data) throw notFound("Collection not found");

		// Agents can only see their own; managers+ see anything in the tenant.
		if (auth.role === "agent" && data.collection.agentId !== auth.sub) {
			throw forbidden("This collection is not yours");
		}

		// Resolve the agent's display name from the auth-only users table.
		const [agent] = await withoutTenant(async (tx) =>
			tx
				.select({
					id: users.id,
					name: users.name,
					agentCode: users.agentCode,
				})
				.from(users)
				.where(
					and(
						eq(users.id, data.collection.agentId),
						eq(users.tenantId, auth.tid),
					),
				)
				.limit(1),
		);

		return NextResponse.json({
			collection: data.collection,
			customer: {
				name: data.customerName,
				code: data.customerCode,
				address: data.customerAddress,
				phone: data.customerPhone,
			},
			agent: agent ?? null,
			reversals: data.reversals,
		});
	} catch (err) {
		return toResponse(err);
	}
}
