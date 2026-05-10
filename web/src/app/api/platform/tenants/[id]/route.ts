import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { tenants } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { requirePlatformAuth } from "@/lib/auth/platform-context";
import { badRequest, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const PatchBody = z.object({
	name: z.string().trim().min(2).max(120).optional(),
	isActive: z.boolean().optional(),
});

export async function PATCH(
	req: NextRequest,
	ctx: { params: Promise<{ id: string }> },
) {
	try {
		await requirePlatformAuth();
		const { id } = await ctx.params;
		const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
		if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
		const patch = parsed.data;
		if (patch.name === undefined && patch.isActive === undefined) {
			throw badRequest("No changes supplied");
		}

		const [row] = await withoutTenant(async (tx) =>
			tx
				.update(tenants)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(tenants.id, id))
				.returning(),
		);
		if (!row) throw notFound("Tenant not found");
		return NextResponse.json({ tenant: row });
	} catch (err) {
		return toResponse(err);
	}
}
