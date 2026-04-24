import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { users } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { badRequest, notFound, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  agentCode: z.string().min(1).max(16).optional(),
  isActive: z.boolean().optional(),
});

async function findAgent(tenantId: string, id: string) {
  return withoutTenant(async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)))
      .limit(1);
    return rows[0];
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    const row = await findAgent(auth.tid, id);
    if (!row) throw notFound("Agent not found");
    // Never send the password hash back to any client.
    const safe = { ...row, passwordHash: undefined } as Omit<
      typeof row,
      "passwordHash"
    > & { passwordHash?: undefined };
    delete (safe as { passwordHash?: unknown }).passwordHash;
    return NextResponse.json({ agent: safe });
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

    const existing = await findAgent(auth.tid, id);
    if (!existing) throw notFound("Agent not found");

    // Managers cannot touch other managers or super_admins.
    if (auth.role === "manager" && existing.role !== "agent") {
      throw notFound("Agent not found");
    }
    // Nobody can edit a super_admin via this route.
    if (existing.role === "super_admin") {
      throw notFound("Agent not found");
    }

    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ agent: existing });
    }

    const updated = await withoutTenant(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(and(eq(users.tenantId, auth.tid), eq(users.id, id)))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          agentCode: users.agentCode,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
        });

      await appendAudit(tx, {
        tenantId: auth.tid,
        actorId: auth.sub,
        action:
          updates.isActive === false
            ? "agent.deactivate"
            : updates.isActive === true
              ? "agent.activate"
              : "agent.update",
        entityType: "user",
        entityId: id,
        before: {
          name: existing.name,
          agentCode: existing.agentCode,
          isActive: existing.isActive,
        },
        after: {
          name: row.name,
          agentCode: row.agentCode,
          isActive: row.isActive,
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

    return NextResponse.json({ agent: updated });
  } catch (err) {
    return toResponse(err);
  }
}
