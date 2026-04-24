import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { customers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const CreateBody = z.object({
  code: z.string().min(1).max(64).optional().nullable(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  email: z.string().email().max(200).optional().nullable().or(z.literal("")),
  category: z.string().max(64).optional().nullable(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  geofenceRadiusM: z.number().int().min(50).max(500).default(100),
  outstandingBalance: z.number().finite().default(0),
  creditLimit: z.number().finite().optional().nullable(),
  assignedAgentId: z.string().uuid().optional().nullable(),
});

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
          email: customers.email,
          category: customers.category,
          lat: customers.lat,
          lng: customers.lng,
          geofenceRadiusM: customers.geofenceRadiusM,
          outstandingBalance: customers.outstandingBalance,
          creditLimit: customers.creditLimit,
          assignedAgentId: customers.assignedAgentId,
          createdAt: customers.createdAt,
        })
        .from(customers)
        .orderBy(customers.name);
    });
    return NextResponse.json({ customers: rows });
  } catch (err) {
    return toResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, "super_admin", "manager");

    const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw badRequest("Invalid body", parsed.error.flatten());
    const data = parsed.data;

    const created = await withTenant(auth.tid, async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({
          tenantId: auth.tid,
          code: data.code ?? null,
          name: data.name,
          address: data.address ?? null,
          phone: data.phone ?? null,
          email: data.email === "" ? null : (data.email ?? null),
          category: data.category ?? null,
          lat: data.lat,
          lng: data.lng,
          geofenceRadiusM: data.geofenceRadiusM,
          outstandingBalance: data.outstandingBalance,
          creditLimit: data.creditLimit ?? null,
          assignedAgentId: data.assignedAgentId ?? null,
        })
        .returning();

      await appendAudit(tx, {
        tenantId: auth.tid,
        actorId: auth.sub,
        action: "customer.create",
        entityType: "customer",
        entityId: row.id,
        after: {
          name: row.name,
          code: row.code,
          lat: row.lat,
          lng: row.lng,
          geofenceRadiusM: row.geofenceRadiusM,
        },
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          req.headers.get("x-real-ip") ??
          null,
        deviceId: null,
        userAgent: req.headers.get("user-agent"),
      });

      return row;
    });

    return NextResponse.json({ customer: created }, { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
