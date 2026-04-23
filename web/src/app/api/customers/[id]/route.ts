import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { customers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
	try {
		const auth = await requireAuth();
		const { id } = await ctx.params;

		const row = await withTenant(auth.tid, async (tx) => {
			const rows = await tx
				.select()
				.from(customers)
				.where(eq(customers.id, id))
				.limit(1);
			return rows[0];
		});

		// RLS guarantees: if the customer belongs to another tenant we get 0 rows,
		// same as if the id didn't exist. Either way -> 404, no existence leak.
		if (!row) throw notFound("Customer not found");

		return NextResponse.json({ customer: row });
	} catch (err) {
		return toResponse(err);
	}
}
