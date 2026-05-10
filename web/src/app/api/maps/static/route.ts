import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/auth/context";
import { badRequest, tooMany, toResponse } from "@/lib/errors";
import { fetchStaticMapPng } from "@/lib/maps/static";
import { limitGeocode, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Phase 10 / Track C1 - server-side proxy for Google Static Maps so the
 * Android app can embed a GPS-pin thumbnail in its on-device PDF without
 * shipping the Maps API key inside the APK. Reuses the existing
 * `fetchStaticMapPng` helper that the web receipt route already uses,
 * and shares the `geocode` rate-limit bucket (per tenant + user) since
 * both buckets pull from the same Google Maps quota.
 *
 *   GET /api/maps/static?lat=12.97&lng=77.59&zoom=16&w=320&h=220&scale=2
 *
 * Returns `image/png` bytes, with a 1-day public Cache-Control so the
 * device's HTTP cache can serve repeated re-renders without burning new
 * quota on every receipt preview reload.
 */
const Query = z.object({
	lat: z.coerce.number().min(-90).max(90),
	lng: z.coerce.number().min(-180).max(180),
	zoom: z.coerce.number().int().min(1).max(20).default(16),
	w: z.coerce.number().int().min(64).max(640).default(320),
	h: z.coerce.number().int().min(64).max(640).default(220),
	scale: z.coerce.number().int().refine((v) => v === 1 || v === 2, {
		message: "scale must be 1 or 2",
	}).default(2),
});

export async function GET(req: NextRequest) {
	try {
		const auth = await requireAuth();

		const rl = await limitGeocode(auth.tid, auth.sub);
		const rlHeaders = rateLimitHeaders(rl);
		if (!rl.success) {
			const err = tooMany("Too many static-map requests. Try again shortly.");
			return NextResponse.json(
				{ error: { code: err.code, message: err.message } },
				{ status: err.status, headers: rlHeaders },
			);
		}

		const sp = req.nextUrl.searchParams;
		const parsed = Query.safeParse({
			lat: sp.get("lat"),
			lng: sp.get("lng"),
			zoom: sp.get("zoom") ?? undefined,
			w: sp.get("w") ?? undefined,
			h: sp.get("h") ?? undefined,
			scale: sp.get("scale") ?? undefined,
		});
		if (!parsed.success) {
			throw badRequest("Invalid params", parsed.error.flatten());
		}

		const png = await fetchStaticMapPng({
			lat: parsed.data.lat,
			lng: parsed.data.lng,
			zoom: parsed.data.zoom,
			width: parsed.data.w,
			height: parsed.data.h,
			scale: parsed.data.scale as 1 | 2,
		});
		if (!png) {
			return NextResponse.json(
				{
					error: {
						code: "upstream_error",
						message:
							"Static map unavailable (Maps API key not configured or upstream rejected the request)",
					},
				},
				{ status: 502, headers: rlHeaders },
			);
		}

		return new NextResponse(new Uint8Array(png), {
			status: 200,
			headers: {
				...rlHeaders,
				"Content-Type": "image/png",
				// 24h public cache - the same lat/lng/zoom always renders the same
				// tile and a stale receipt PDF would still be a valid receipt.
				"Cache-Control": "public, max-age=86400, immutable",
			},
		});
	} catch (err) {
		return toResponse(err);
	}
}
