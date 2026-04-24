import { and, desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { users } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth, requireRole } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { badRequest, toResponse } from "@/lib/errors";

export const runtime = "nodejs";

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  agentCode: z.string().min(1).max(16),
  role: z.enum(["agent", "manager"]).default("agent"),
});

/**
 * `users` is an auth-only table (vcts_app has no grants) so we use
 * `withoutTenant` but explicitly filter by `auth.tid` on every query to
 * re-establish tenant isolation in code.
 */
export async function GET() {
  try {
    const auth = await requireAuth();

    const rows = await withoutTenant(async (tx) => {
      return tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          agentCode: users.agentCode,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(
          and(
            eq(users.tenantId, auth.tid),
            // Show agents + managers so managers view their own row too.
            // Super_admins are hidden from this list for safety.
          ),
        )
        .orderBy(desc(users.createdAt));
    });

    // Filter client-side to agents/managers only.
    const visible = rows.filter(
      (r) => r.role === "agent" || r.role === "manager",
    );

    return NextResponse.json({ agents: visible });
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
    const { name, email, password, agentCode, role } = parsed.data;

    // Managers can only create agents, not other managers.
    if (auth.role === "manager" && role !== "agent") {
      throw badRequest("Managers can only create agent accounts");
    }

    const passwordHash = await hashPassword(password);

    const created = await withoutTenant(async (tx) => {
      // Double-check email uniqueness (globally unique per PRD).
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing[0]) {
        throw badRequest("That email is already registered");
      }

      const [inserted] = await tx
        .insert(users)
        .values({
          tenantId: auth.tid,
          email,
          passwordHash,
          name,
          agentCode,
          role,
          isActive: true,
        })
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          agentCode: users.agentCode,
          isActive: users.isActive,
          createdAt: users.createdAt,
        });

      await appendAudit(tx, {
        tenantId: auth.tid,
        actorId: auth.sub,
        action: "agent.create",
        entityType: "user",
        entityId: inserted.id,
        after: {
          email: inserted.email,
          role: inserted.role,
          agentCode: inserted.agentCode,
        },
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          req.headers.get("x-real-ip") ??
          null,
        deviceId: null,
        userAgent: req.headers.get("user-agent"),
      });

      return inserted;
    });

    return NextResponse.json({ agent: created }, { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
