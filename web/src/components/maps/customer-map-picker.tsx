"use client";

import * as React from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  useMap,
} from "@vis.gl/react-google-maps";
import { LoaderCircle, MapPin, Search } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useTheme } from "next-themes";

export type LatLng = { lat: number; lng: number };

interface Props {
  value: LatLng;
  radiusM: number;
  onChange: (next: LatLng) => void;
  address?: string;
  onAddressChange?: (address: string) => void;
  apiKey?: string;
}

export function CustomerMapPicker({
  value,
  radiusM,
  onChange,
  address,
  onAddressChange,
  apiKey,
}: Props) {
  const key = apiKey ?? process.env.NEXT_PUBLIC_MAPS_API_KEY ?? "";
  const { resolvedTheme } = useTheme();

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
      <div className="space-y-3">
        <GeocodeSearch
          defaultValue={address}
          onPick={(p) => {
            onChange({ lat: p.lat, lng: p.lng });
            onAddressChange?.(p.label);
          }}
        />
        <div className="relative h-[320px] w-full overflow-hidden rounded-lg border">
          <Map
            key={resolvedTheme}
            defaultCenter={value}
            defaultZoom={16}
            center={value}
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapId="vcts-customer-picker"
            colorScheme={resolvedTheme === "dark" ? "DARK" : "LIGHT"}
            onClick={(e) => {
              if (!e.detail.latLng) return;
              onChange({
                lat: e.detail.latLng.lat,
                lng: e.detail.latLng.lng,
              });
            }}
          >
            <AdvancedMarker position={value}>
              <Pin
                background="hsl(var(--primary))"
                borderColor="hsl(var(--primary))"
                glyphColor="#fff"
              />
            </AdvancedMarker>
            <FenceCircle center={value} radiusM={radiusM} />
          </Map>
        </div>
        <p className="text-xs text-muted-foreground">
          Tap anywhere on the map to move the pin. Use search to jump to an
          address.
        </p>
      </div>
    </APIProvider>
  );
}

function FenceCircle({
  center,
  radiusM,
}: {
  center: LatLng;
  radiusM: number;
}) {
  const map = useMap();
  const circleRef = React.useRef<google.maps.Circle | null>(null);

  React.useEffect(() => {
    if (!map || typeof window === "undefined") return;
    const g = window.google;
    if (!g?.maps) return;

    const circle = new g.maps.Circle({
      map,
      center,
      radius: radiusM,
      strokeColor: "hsl(var(--primary))",
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: "hsl(var(--primary))",
      fillOpacity: 0.12,
    });
    circleRef.current = circle;
    return () => {
      circle.setMap(null);
      circleRef.current = null;
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    circleRef.current?.setCenter(center);
  }, [center.lat, center.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    circleRef.current?.setRadius(radiusM);
  }, [radiusM]);

  return null;
}

function GeocodeSearch({
  defaultValue,
  onPick,
}: {
  defaultValue?: string;
  onPick: (r: { label: string; lat: number; lng: number }) => void;
}) {
  const [q, setQ] = React.useState(defaultValue ?? "");

  const lookup = useMutation({
    mutationFn: async (query: string) => {
      const r = await api<{
        results: Array<{ label: string; lat: number; lng: number }>;
      }>(`/api/geocode?q=${encodeURIComponent(query)}`);
      return r.results[0];
    },
    onSuccess: (r) => {
      if (r) onPick(r);
    },
  });

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) lookup.mutate(q.trim());
      }}
    >
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search address"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={lookup.isPending}>
        {lookup.isPending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <MapPin className="size-4" />
        )}
        Locate
      </Button>
    </form>
  );
}
