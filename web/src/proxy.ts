import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge proxy (formerly `middleware`) that gates `/(app)` routes behind the
 * `vcts_access` cookie. We intentionally do NOT verify the JWT signature
 * here - the edge runtime can't access the Node-only `jose` setup with our
 * RS256 key, and the actual server components + route handlers re-verify
 * on every call via `requireAuth()`. The cookie check is just a low-cost
 * UX redirect so users don't land on a blank authenticated shell when
 * their session is gone.
 */
export function proxy(req: NextRequest) {
  const token = req.cookies.get("vcts_access")?.value;

  if (!token) {
    const url = req.nextUrl.clone();
    const next = req.nextUrl.pathname + req.nextUrl.search;
    url.pathname = "/login";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/agents/:path*",
    "/customers/:path*",
    "/settings/:path*",
  ],
};
