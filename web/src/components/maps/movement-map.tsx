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

export type Fix = {
	id: string;
	lat: number;
	lng: number;
	loggedAt: string;
};

export type CustomerPin = {
	id: string;
	name: string;
	lat: number;
	lng: number;
	radiusM: number;
};

interface Props {
	fixes: Fix[];
	customers?: CustomerPin[];
	apiKey?: string;
}

/**
 * Phase 9 - read-only polyline + customer pins for the manager replay.
 * The polyline is rendered through a `useEffect` that imperatively
 * builds a `google.maps.Polyline` because the `<Polyline>` JSX wrapper
 * isn't part of `@vis.gl/react-google-maps`.
 */
export function MovementMap({ fixes, customers = [], apiKey }: Props) {
	const key = apiKey ?? process.env.NEXT_PUBLIC_MAPS_API_KEY ?? "";
	const { resolvedTheme } = useTheme();

	const center = React.useMemo<{ lat: number; lng: number }>(() => {
		if (fixes.length > 0) {
			return { lat: fixes[0].lat, lng: fixes[0].lng };
		}
		if (customers.length > 0) {
			return { lat: customers[0].lat, lng: customers[0].lng };
		}
		return { lat: 12.97, lng: 77.59 };
	}, [fixes, customers]);

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
			<div className="relative h-[520px] w-full overflow-hidden rounded-xl border">
				<Map
					key={resolvedTheme}
					defaultCenter={center}
					defaultZoom={fixes.length > 0 ? 14 : 11}
					gestureHandling="greedy"
					disableDefaultUI={false}
					mapId="vcts-movement"
					colorScheme={resolvedTheme === "dark" ? "DARK" : "LIGHT"}
				>
					<MovementPolyline fixes={fixes} />
					<FitBounds fixes={fixes} customers={customers} />
					{customers.map((c) => (
						<React.Fragment key={c.id}>
							<AdvancedMarker
								position={{ lat: c.lat, lng: c.lng }}
								title={c.name}
							>
								<Pin
									background="hsl(var(--muted-foreground))"
									borderColor="hsl(var(--muted-foreground))"
									glyphColor="#fff"
									scale={0.8}
								/>
							</AdvancedMarker>
							<FenceCircle
								center={{ lat: c.lat, lng: c.lng }}
								radiusM={c.radiusM}
							/>
						</React.Fragment>
					))}
					{fixes.length > 0 && (
						<AdvancedMarker
							position={{ lat: fixes[0].lat, lng: fixes[0].lng }}
							title="Day start"
						>
							<Pin
								background="hsl(var(--primary))"
								borderColor="hsl(var(--primary))"
								glyphColor="#fff"
							>
								A
							</Pin>
						</AdvancedMarker>
					)}
					{fixes.length > 1 && (
						<AdvancedMarker
							position={{
								lat: fixes[fixes.length - 1].lat,
								lng: fixes[fixes.length - 1].lng,
							}}
							title="Day end"
						>
							<Pin
								background="hsl(var(--destructive))"
								borderColor="hsl(var(--destructive))"
								glyphColor="#fff"
							>
								B
							</Pin>
						</AdvancedMarker>
					)}
				</Map>
				{fixes.length === 0 && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
						No location fixes recorded for this day.
					</div>
				)}
			</div>
		</APIProvider>
	);
}

function MovementPolyline({ fixes }: { fixes: Fix[] }) {
	const map = useMap();
	const polylineRef = React.useRef<google.maps.Polyline | null>(null);

	React.useEffect(() => {
		if (!map || typeof window === "undefined") return;
		const g = window.google;
		if (!g?.maps) return;

		const path = fixes.map((f) => ({ lat: f.lat, lng: f.lng }));

		const polyline = new g.maps.Polyline({
			map,
			path,
			geodesic: true,
			strokeColor: "hsl(var(--primary))",
			strokeOpacity: 0.95,
			strokeWeight: 4,
			icons: [
				{
					icon: {
						path: g.maps.SymbolPath.FORWARD_OPEN_ARROW,
						scale: 2.4,
						strokeWeight: 2,
					},
					offset: "100%",
					repeat: "120px",
				},
			],
		});
		polylineRef.current = polyline;
		return () => {
			polyline.setMap(null);
			polylineRef.current = null;
		};
	}, [map, fixes]);

	return null;
}

function FenceCircle({
	center,
	radiusM,
}: {
	center: { lat: number; lng: number };
	radiusM: number;
}) {
	const map = useMap();
	const lat = center.lat;
	const lng = center.lng;
	React.useEffect(() => {
		if (!map || typeof window === "undefined") return;
		const g = window.google;
		if (!g?.maps) return;
		const circle = new g.maps.Circle({
			map,
			center: { lat, lng },
			radius: radiusM,
			strokeColor: "hsl(var(--muted-foreground))",
			strokeOpacity: 0.4,
			strokeWeight: 1,
			fillColor: "hsl(var(--muted-foreground))",
			fillOpacity: 0.06,
		});
		return () => circle.setMap(null);
	}, [map, lat, lng, radiusM]);
	return null;
}

function FitBounds({
	fixes,
	customers,
}: {
	fixes: Fix[];
	customers: CustomerPin[];
}) {
	const map = useMap();
	React.useEffect(() => {
		if (!map || typeof window === "undefined") return;
		const g = window.google;
		if (!g?.maps) return;
		if (fixes.length === 0 && customers.length === 0) return;
		const bounds = new g.maps.LatLngBounds();
		fixes.forEach((f) => bounds.extend({ lat: f.lat, lng: f.lng }));
		customers.forEach((c) => bounds.extend({ lat: c.lat, lng: c.lng }));
		if (!bounds.isEmpty()) {
			map.fitBounds(bounds, { top: 24, right: 24, bottom: 24, left: 24 });
		}
	}, [map, fixes, customers]);
	return null;
}
