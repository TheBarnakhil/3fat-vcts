"use client";

import * as React from "react";
import {
	APIProvider,
	Map,
	AdvancedMarker,
	Pin,
	useMap,
} from "@vis.gl/react-google-maps";
import { useTheme } from "next-themes";

export type LiveAgentFix = {
	agentId: string;
	agentName: string;
	agentCode: string | null;
	lat: number;
	lng: number;
	accuracyM: number | null;
	batteryPct: number | null;
	loggedAt: string;
};

interface Props {
	fixes: LiveAgentFix[];
	apiKey?: string;
	emptyHint?: string;
}

/**
 * Phase 10 / Track C2 - "where is everyone right now?". Renders one
 * `AdvancedMarker` per agent with the latest fix, plus an accuracy
 * circle so a stale or low-precision fix is visually obvious. The map
 * recenters on the agents whenever the fix set changes shape (added /
 * removed agent), but otherwise keeps the user's pan + zoom intact.
 */
export function LiveMap({
	fixes,
	apiKey,
	emptyHint,
}: Props) {
	const key = apiKey ?? process.env.NEXT_PUBLIC_MAPS_API_KEY ?? "";
	const { resolvedTheme } = useTheme();

	const center = React.useMemo<{ lat: number; lng: number }>(() => {
		if (fixes.length > 0) return { lat: fixes[0].lat, lng: fixes[0].lng };
		return { lat: 12.97, lng: 77.59 };
	}, [fixes]);

	if (!key) {
		return (
			<div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
				Google Maps API key missing. Set
				<code className="mx-1 font-mono">NEXT_PUBLIC_MAPS_API_KEY</code>
				and reload.
			</div>
		);
	}

	return (
		<APIProvider apiKey={key}>
			<div className="relative h-[640px] w-full overflow-hidden rounded-xl border">
				<Map
					key={resolvedTheme}
					defaultCenter={center}
					defaultZoom={fixes.length > 0 ? 11 : 10}
					gestureHandling="greedy"
					disableDefaultUI={false}
					mapId="vcts-live"
					colorScheme={resolvedTheme === "dark" ? "DARK" : "LIGHT"}
				>
					<FitToFixes fixes={fixes} />
					{fixes.map((fix) => (
						<React.Fragment key={fix.agentId}>
							<AccuracyCircle
								center={{ lat: fix.lat, lng: fix.lng }}
								radiusM={Math.max(fix.accuracyM ?? 25, 25)}
								staleness={staleness(fix.loggedAt)}
							/>
							<AdvancedMarker
								position={{ lat: fix.lat, lng: fix.lng }}
								title={`${fix.agentName} · ${formatRelative(staleness(fix.loggedAt))} ago`}
							>
								<Pin
									background={pinColor(staleness(fix.loggedAt))}
									borderColor={pinColor(staleness(fix.loggedAt))}
									glyphColor="#fff"
								>
									{(fix.agentCode ?? fix.agentName.slice(0, 1)).slice(0, 2)}
								</Pin>
							</AdvancedMarker>
						</React.Fragment>
					))}
				</Map>
				{fixes.length === 0 && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
						{emptyHint ?? "No agents on duty in the last 30 minutes."}
					</div>
				)}
			</div>
		</APIProvider>
	);
}

function FitToFixes({ fixes }: { fixes: LiveAgentFix[] }) {
	const map = useMap();
	// Re-fit only when the set of agents changes shape, not on every
	// snapshot. Otherwise the map would re-center continuously and the
	// user could never pan to investigate a specific pin.
	const idsKey = React.useMemo(
		() => fixes.map((f) => f.agentId).sort().join(","),
		[fixes],
	);
	React.useEffect(() => {
		if (!map || typeof window === "undefined") return;
		const g = window.google;
		if (!g?.maps) return;
		if (fixes.length === 0) return;
		const bounds = new g.maps.LatLngBounds();
		fixes.forEach((f) => bounds.extend({ lat: f.lat, lng: f.lng }));
		if (!bounds.isEmpty()) {
			map.fitBounds(bounds, { top: 32, right: 32, bottom: 32, left: 32 });
			// Cap zoom on a single-agent fit so the map doesn't jam down to
			// street level - 14 keeps a few hundred metres visible around
			// the pin.
			if (fixes.length === 1) {
				const z = map.getZoom();
				if (z != null && z > 14) map.setZoom(14);
			}
		}
		// We deliberately depend on `idsKey`, not `fixes`, so a pure
		// position update doesn't yank the map.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [map, idsKey]);
	return null;
}

function AccuracyCircle({
	center,
	radiusM,
	staleness: stalenessSec,
}: {
	center: { lat: number; lng: number };
	radiusM: number;
	staleness: number;
}) {
	const map = useMap();
	const lat = center.lat;
	const lng = center.lng;
	React.useEffect(() => {
		if (!map || typeof window === "undefined") return;
		const g = window.google;
		if (!g?.maps) return;
		const stroke = pinColor(stalenessSec);
		const circle = new g.maps.Circle({
			map,
			center: { lat, lng },
			radius: radiusM,
			strokeColor: stroke,
			strokeOpacity: 0.5,
			strokeWeight: 1,
			fillColor: stroke,
			fillOpacity: 0.08,
			clickable: false,
		});
		return () => circle.setMap(null);
	}, [map, lat, lng, radiusM, stalenessSec]);
	return null;
}

function staleness(iso: string): number {
	return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

function pinColor(staleSec: number): string {
	if (staleSec <= 120) return "hsl(var(--primary))"; // fresh
	if (staleSec <= 600) return "hsl(38 92% 50%)"; // amber-500
	return "hsl(var(--muted-foreground))"; // stale
}

function formatRelative(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
