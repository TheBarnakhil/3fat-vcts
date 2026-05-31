"use client";

import * as React from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { LoaderCircle, MapPin, Search } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  createSessionToken,
  fetchPlaceSuggestions,
  type PlaceSuggestion,
} from "@/lib/maps/places";
import { useTheme } from "next-themes";

export type LatLng = { lat: number; lng: number };

interface Props {
  value: LatLng;
  radiusM: number;
  onChange: (next: LatLng) => void;
  address?: string;
  onAddressChange?: (address: string) => void;
  apiKey?: string;
  /** When true, hides the search box and ignores map clicks. Used in view-only mode. */
  readOnly?: boolean;
}

export function CustomerMapPicker({
  value,
  radiusM,
  onChange,
  address,
  onAddressChange,
  apiKey,
  readOnly = false,
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
        {!readOnly && (
          <LocationSearch
            defaultValue={address}
            bias={value}
            onPick={(p) => {
              onChange({ lat: p.lat, lng: p.lng });
              onAddressChange?.(p.label);
            }}
          />
        )}
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
            onClick={
              readOnly
                ? undefined
                : (e) => {
                    if (!e.detail.latLng) return;
                    onChange({
                      lat: e.detail.latLng.lat,
                      lng: e.detail.latLng.lng,
                    });
                  }
            }
          >
            <AdvancedMarker position={value}>
              <Pin
                background="hsl(var(--primary))"
                borderColor="hsl(var(--primary))"
                glyphColor="#fff"
              />
            </AdvancedMarker>
            <FenceCircle center={value} radiusM={radiusM} />
            <RecenterOnChange center={value} />
          </Map>
        </div>
        {!readOnly && (
          <p className="text-xs text-muted-foreground">
            Tap anywhere on the map to move the pin. Use search to jump to an
            address.
          </p>
        )}
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

function RecenterOnChange({ center }: { center: LatLng }) {
  const map = useMap();

  React.useEffect(() => {
    if (!map) return;
    map.panTo(center);
  }, [map, center.lat, center.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Minimum characters before we start asking Google for suggestions. */
const MIN_QUERY_LENGTH = 3;
/** Debounce so we don't fire an Autocomplete request on every keystroke. */
const SUGGEST_DEBOUNCE_MS = 250;

/**
 * Address search with a Google-Maps-style typeahead dropdown.
 *
 * Primary path: as the manager types we query the Places library and show
 * suggestions; picking one drops the pin at its precise location. Fallbacks
 * (per product decision): the "Locate" button still runs the server-side
 * `/api/geocode` lookup, and the map itself stays click-to-place.
 */
function LocationSearch({
  defaultValue,
  bias,
  onPick,
}: {
  defaultValue?: string;
  bias?: LatLng;
  onPick: (r: { label: string; lat: number; lng: number }) => void;
}) {
  const places = useMapsLibrary("places");
  const [q, setQ] = React.useState(defaultValue ?? "");
  const [suggestions, setSuggestions] = React.useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [resolving, setResolving] = React.useState(false);
  const sessionTokenRef =
    React.useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const blurTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server-side geocode is kept as the manual "Locate" fallback.
  const lookup = useMutation({
    mutationFn: async (query: string) => {
      const r = await api<{
        results: Array<{ label: string; lat: number; lng: number }>;
      }>(`/api/geocode?q=${encodeURIComponent(query)}`);
      return r.results[0];
    },
    onSuccess: (r) => {
      if (!r) {
        toast.error("No matching location found.");
        return;
      }
      onPick(r);
    },
    onError: () => {
      toast.error("Could not find that address. Try a more specific search.");
    },
  });

  // Debounced typeahead. Each session shares one token until a pick (or the
  // input is cleared), which is what keeps Autocomplete billed per session.
  const biasLat = bias?.lat;
  const biasLng = bias?.lng;
  React.useEffect(() => {
    const term = q.trim();
    let cancelled = false;
    // All state updates live inside the debounced callback (never
    // synchronously in the effect body) so we don't trigger cascading
    // renders on every keystroke.
    const handle = setTimeout(async () => {
      if (!places || term.length < MIN_QUERY_LENGTH) {
        if (!cancelled) {
          setSuggestions([]);
          setOpen(false);
        }
        return;
      }
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = createSessionToken(places);
      }
      try {
        const next = await fetchPlaceSuggestions(
          places,
          term,
          sessionTokenRef.current,
          biasLat != null && biasLng != null
            ? { lat: biasLat, lng: biasLng }
            : undefined,
        );
        if (cancelled) return;
        setSuggestions(next);
        setActiveIndex(-1);
        setOpen(next.length > 0);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, places, biasLat, biasLng]);

  React.useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  const choose = React.useCallback(
    async (suggestion: PlaceSuggestion) => {
      setOpen(false);
      setResolving(true);
      try {
        const resolved = await suggestion.resolve();
        // The session ends at the pick; the next keystroke starts a new one.
        sessionTokenRef.current = null;
        if (!resolved) {
          toast.error("Couldn't load that place. Try another suggestion.");
          return;
        }
        setQ(resolved.label);
        setSuggestions([]);
        onPick(resolved);
      } finally {
        setResolving(false);
      }
    },
    [onPick],
  );

  const runGeocode = React.useCallback(() => {
    const v = q.trim();
    if (v) lookup.mutate(v);
  }, [lookup, q]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        void choose(suggestions[activeIndex]);
      } else if (suggestions.length > 0) {
        void choose(suggestions[0]);
      } else {
        runGeocode();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="flex items-start gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-[18px] size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search address"
          value={q}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
        />
        {open && suggestions.length > 0 && (
          <ul
            className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
            // Keep input focus so the click lands before onBlur closes us.
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left",
                    i === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => void choose(s)}
                >
                  <span className="text-sm font-medium leading-tight">
                    {s.primary}
                  </span>
                  {s.secondary && (
                    <span className="text-xs text-muted-foreground leading-tight">
                      {s.secondary}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={lookup.isPending || resolving}
        onClick={runGeocode}
      >
        {lookup.isPending || resolving ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <MapPin className="size-4" />
        )}
        Locate
      </Button>
    </div>
  );
}
