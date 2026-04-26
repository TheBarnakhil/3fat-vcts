/**
 * Great-circle distance between two WGS84 coordinates in metres.
 *
 * We deliberately use the Haversine formula (not Vincenty / geodetic) - the
 * customer pin and the agent's GPS fix are both already noisy at the metre
 * level, and Haversine is good to ~0.5% which is at least an order of
 * magnitude tighter than the noise we care about. Stays simple and fast.
 *
 * R = 6_371_000 m is the WGS84 mean Earth radius.
 */
export function haversineMeters(
	a: { lat: number; lng: number },
	b: { lat: number; lng: number },
): number {
	const R = 6_371_000;
	const toRad = (deg: number) => (deg * Math.PI) / 180;

	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);

	const sinDLat = Math.sin(dLat / 2);
	const sinDLng = Math.sin(dLng / 2);

	const h =
		sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
