import { env } from "../env";

/**
 * Builds a Google Static Maps URL with a single red marker centered on
 * the given coordinate. Phase 8 uses this for the receipt PDF + the
 * public verify page; both call points fetch the PNG bytes server-side
 * so the API key never leaks to the client.
 *
 * Returns null if no `MAPS_API_KEY` is configured (dev environment) -
 * receipts then render with a "GPS pin not available" placeholder.
 */
export function staticMapUrl(opts: {
	lat: number;
	lng: number;
	zoom?: number;
	width?: number;
	height?: number;
	scale?: 1 | 2;
}): string | null {
	if (!env.MAPS_API_KEY) return null;
	const zoom = opts.zoom ?? 16;
	const width = opts.width ?? 320;
	const height = opts.height ?? 220;
	const scale = opts.scale ?? 2;
	const params = new URLSearchParams({
		center: `${opts.lat.toFixed(6)},${opts.lng.toFixed(6)}`,
		zoom: String(zoom),
		size: `${width}x${height}`,
		scale: String(scale),
		format: "png",
		maptype: "roadmap",
		markers: `color:red|${opts.lat.toFixed(6)},${opts.lng.toFixed(6)}`,
		key: env.MAPS_API_KEY,
	});
	return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

/**
 * Server-side fetch for the static-map PNG. Returns null on any
 * failure - receipt rendering must remain best-effort.
 */
export async function fetchStaticMapPng(opts: {
	lat: number;
	lng: number;
	zoom?: number;
	width?: number;
	height?: number;
	scale?: 1 | 2;
}): Promise<Uint8Array | null> {
	const url = staticMapUrl(opts);
	if (!url) return null;
	try {
		const res = await fetch(url, {
			cache: "no-store",
			headers: { Accept: "image/png" },
		});
		if (!res.ok) return null;
		const buf = await res.arrayBuffer();
		return new Uint8Array(buf);
	} catch {
		return null;
	}
}
