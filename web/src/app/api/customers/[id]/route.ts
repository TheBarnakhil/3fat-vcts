import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { customers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const PatchBody = z.object({
  code: z.string().min(1).max(64).optional().nullable(),
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  email: z.string().email().max(200).optional().nullable().or(z.literal("")),
  category: z.string().max(64).optional().nullable(),
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
  geofenceRadiusM: z.number().int().min(50).max(500).optional(),
  outstandingBalance: z.number().finite().optional(),
  creditLimit: z.number().finite().optional().nullable(),
  assignedAgentId: z.string().uuid().optional().nullable(),
});

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    const row = await withTenant(auth.tid, async (tx) => {
      const rows = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, auth.tid),
            auth.role === "agent"
              ? eq(customers.assignedAgentId, auth.sub)
              : undefined,
          ),
        )
        .limit(1);
      return rows[0];
    });
    if (!row) throw notFound("Customer not found");
    return NextResponse.json({ customer: row });
  } catch (err) {
    return toResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, "super_admin", "manager");
    const { id } = await ctx.params;

    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());

    const data = parsed.data;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      sanitized[k] = k === "email" && v === "" ? null : v;
    }
    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ ok: true });
    }

    const updated = await withTenant(auth.tid, async (tx) => {
      const existing = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.tenantId, auth.tid)))
        .limit(1);
      if (!existing[0]) throw notFound("Customer not found");

      const [row] = await tx
        .update(customers)
        .set({ ...sanitized, updatedAt: new Date() })
        .where(and(eq(customers.id, id), eq(customers.tenantId, auth.tid)))
        .returning();

      await appendAudit(tx, {
        tenantId: auth.tid,
        actorId: auth.sub,
        action: "customer.update",
        entityType: "customer",
        entityId: id,
        before: existing[0],
        after: row,
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          req.headers.get("x-real-ip") ??
          null,
        deviceId: null,
        userAgent: req.headers.get("user-agent"),
      });

      return row;
    });

    return NextResponse.json({ customer: updated });
  } catch (err) {
    return toResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, "super_admin");
    const { id } = await ctx.params;

    await withTenant(auth.tid, async (tx) => {
      const existing = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.tenantId, auth.tid)))
        .limit(1);
      if (!existing[0]) throw notFound("Customer not found");

      await tx
        .delete(customers)
        .where(and(eq(customers.id, id), eq(customers.tenantId, auth.tid)));

      await appendAudit(tx, {
        tenantId: auth.tid,
        actorId: auth.sub,
        action: "customer.delete",
        entityType: "customer",
        entityId: id,
        before: existing[0],
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          req.headers.get("x-real-ip") ??
          null,
        deviceId: null,
        userAgent: req.headers.get("user-agent"),
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
