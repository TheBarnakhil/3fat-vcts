import { NextResponse } from "next/server";

import { requirePlatformAuth } from "@/lib/auth/platform-context";
import { toResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET() {
	try {
		const auth = await requirePlatformAuth();
		return NextResponse.json({
			user: {
				id: auth.sub,
				email: auth.email,
				name: auth.name,
				role: auth.role,
			},
		});
	} catch (err) {
		return toResponse(err);
	}
}
