import { NextResponse } from "next/server";

import { PLATFORM_ACCESS_COOKIE } from "@/lib/auth/platform-context";

export const runtime = "nodejs";

export async function POST() {
	const res = NextResponse.json({ ok: true });
	res.cookies.set(PLATFORM_ACCESS_COOKIE, "", {
		httpOnly: true,
		path: "/",
		maxAge: 0,
	});
	return res;
}
