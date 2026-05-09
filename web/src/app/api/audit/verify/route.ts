import { NextResponse } from "next/server";

import { withTenant } from "@/db/tenant";
import { verifyChain } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * Phase 9 - tenant chain integrity check. Walks every audit row for the
 * caller's tenant, recomputes each HMAC, and reports the first break (or
 * a clean bill of health). Restricted to roles that already see the
 * audit trail UI.
 */
export async function GET() {
	try {
		const auth = await requireAuth();
		requireRole(auth, "super_admin", "auditor");

		const result = await withTenant(auth.tid, (tx) =>
			verifyChain(tx, auth.tid),
		);

		return NextResponse.json(result);
	} catch (err) {
		return toResponse(err);
	}
}
