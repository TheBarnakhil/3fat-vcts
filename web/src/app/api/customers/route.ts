import { NextResponse } from "next/server";
import { customers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/auth/context";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
	try {
		const auth = await requireAuth();
		const rows = await withTenant(auth.tid, async (tx) => {
			return tx
				.select({
					id: customers.id,
					code: customers.code,
					name: customers.name,
					address: customers.address,
					phone: customers.phone,
					lat: customers.lat,
					lng: customers.lng,
					geofenceRadiusM: customers.geofenceRadiusM,
					outstandingBalance: customers.outstandingBalance,
					assignedAgentId: customers.assignedAgentId,
				})
				.from(customers)
				.orderBy(customers.name);
		});
		return NextResponse.json({ customers: rows });
	} catch (err) {
		return toResponse(err);
	}
}
