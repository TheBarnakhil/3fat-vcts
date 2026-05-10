import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { badRequest, tooMany, toResponse } from "@/lib/errors";
import { limitGeocode, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Thin proxy around Google's Geocoding API. We keep the key on the server
 * and rate-limit per (tenant, user) so a runaway typeahead can't burn the
 * shared Maps quota.
 *
 *   GET /api/geocode?q=<address>       -> forward geocode
 *   GET /api/geocode?lat=..&lng=..     -> reverse geocode
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();

    const rl = await limitGeocode(auth.tid, auth.sub);
    const rlHeaders = rateLimitHeaders(rl);
    if (!rl.success) {
      const err = tooMany("Too many geocode requests. Try again shortly.");
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status, headers: rlHeaders },
      );
    }

    const key = env.MAPS_API_KEY;
    if (!key) throw badRequest("Maps API key not configured");

    const sp = req.nextUrl.searchParams;
    const q = sp.get("q");
    const lat = sp.get("lat");
    const lng = sp.get("lng");

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("key", key);

    if (q) {
      url.searchParams.set("address", q);
    } else if (lat && lng) {
      url.searchParams.set("latlng", `${lat},${lng}`);
    } else {
      throw badRequest("Provide q=<address> or lat&lng");
    }

    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: { code: "upstream_error", message: `Geocoding failed (${res.status})` } },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      status: string;
      results: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
      }>;
    };

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return NextResponse.json(
        { error: { code: "upstream_error", message: `Geocoding: ${data.status}` } },
        { status: 502 },
      );
    }

    const results = data.results.map((r) => ({
      label: r.formatted_address,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
    }));

    return NextResponse.json({ results }, { headers: rlHeaders });
  } catch (err) {
    return toResponse(err);
  }
}
