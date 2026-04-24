import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { refreshTokens } from "@/db/schema";
import { withoutTenant } from "@/db/tenant";
import { appendAudit } from "@/lib/audit/chain";
import { requireAuth } from "@/lib/auth/context";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth().catch(() => null);

    const body = await req.json().catch(() => ({}) as { refreshToken?: string });
    const refreshToken = (body as { refreshToken?: string }).refreshToken;

    if (auth) {
      await withoutTenant(async (tx) => {
        if (refreshToken) {
          const tokenHash = hashToken(refreshToken);
          await tx
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(refreshTokens.tokenHash, tokenHash));
        } else {
          // Browser logout: revoke every live refresh token for this user.
          await tx
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(refreshTokens.userId, auth.sub));
        }

        await appendAudit(tx, {
          tenantId: auth.tid,
          actorId: auth.sub,
          action: "auth.logout",
          entityType: "user",
          entityId: auth.sub,
          ip:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            req.headers.get("x-real-ip") ??
            null,
          deviceId: null,
          userAgent: req.headers.get("user-agent"),
        });
      });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set("vcts_access", "", {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (err) {
    return toResponse(err);
  }
}
