/**
 * Client-side Google Places autocomplete helper for the customer map picker.
 *
 * Uses the browser Maps JS `places` library (loaded via
 * `useMapsLibrary("places")`) and the shared public key
 * `NEXT_PUBLIC_MAPS_API_KEY`, so we get a real Google-Maps-style typeahead
 * without round-tripping every keystroke through our server.
 *
 * We prefer the modern `AutocompleteSuggestion` / `Place` API (Places API
 * New) and transparently fall back to the legacy `AutocompleteService` /
 * `PlacesService` pair when a key only has the old product enabled. Each
 * returned suggestion carries a `resolve()` closure that fetches the precise
 * lat/lng on demand (one Place Details call), so we don't pay for details on
 * results the user never picks.
 *
 * Billing: callers should create one session token per typing session via
 * [createSessionToken] and discard it after a pick (see usage in
 * `customer-map-picker.tsx`). Grouping keystrokes + the final details call
 * under a single token is what keeps Autocomplete billed per session.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ResolvedPlace {
  lat: number;
  lng: number;
  label: string;
}

export interface PlaceSuggestion {
  /** Stable key for React lists (place id when available). */
  id: string;
  /** Bold first line, e.g. "Connaught Place". */
  primary: string;
  /** Muted second line, e.g. "New Delhi, India". */
  secondary?: string;
  /** Full single-line description used as the input value after a pick. */
  label: string;
  /** Lazily fetch the precise coordinates for this suggestion. */
  resolve: () => Promise<ResolvedPlace | null>;
}

/** Bias suggestions toward this point with a generous city-scale radius. */
const BIAS_RADIUS_M = 30_000;

export function createSessionToken(
  places: google.maps.PlacesLibrary,
): google.maps.places.AutocompleteSessionToken {
  return new places.AutocompleteSessionToken();
}

function hasNewPlacesApi(
  places: google.maps.PlacesLibrary,
): boolean {
  return (
    typeof (
      places as unknown as {
        AutocompleteSuggestion?: { fetchAutocompleteSuggestions?: unknown };
      }
    ).AutocompleteSuggestion?.fetchAutocompleteSuggestions === "function"
  );
}

export async function fetchPlaceSuggestions(
  places: google.maps.PlacesLibrary,
  input: string,
  sessionToken: google.maps.places.AutocompleteSessionToken,
  bias?: LatLng,
): Promise<PlaceSuggestion[]> {
  if (hasNewPlacesApi(places)) {
    return fetchWithNewApi(places, input, sessionToken, bias);
  }
  return fetchWithLegacyApi(places, input, sessionToken, bias);
}

async function fetchWithNewApi(
  places: google.maps.PlacesLibrary,
  input: string,
  sessionToken: google.maps.places.AutocompleteSessionToken,
  bias?: LatLng,
): Promise<PlaceSuggestion[]> {
  const request: google.maps.places.AutocompleteRequest = {
    input,
    sessionToken,
  };
  if (bias) {
    request.locationBias = {
      center: bias,
      radius: BIAS_RADIUS_M,
    };
  }

  const { suggestions } =
    await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

  return suggestions
    .map((s) => s.placePrediction)
    .filter((p): p is google.maps.places.PlacePrediction => p != null)
    .map((prediction) => {
      const label = prediction.text?.text ?? "";
      const primary = prediction.mainText?.text ?? label;
      const secondary = prediction.secondaryText?.text ?? undefined;
      return {
        id: prediction.placeId ?? label,
        primary,
        secondary,
        label,
        resolve: async () => {
          const place = prediction.toPlace();
          await place.fetchFields({
            fields: ["location", "formattedAddress"],
          });
          const loc = place.location;
          if (!loc) return null;
          return {
            lat: loc.lat(),
            lng: loc.lng(),
            label: place.formattedAddress ?? label,
          };
        },
      } satisfies PlaceSuggestion;
    });
}

async function fetchWithLegacyApi(
  places: google.maps.PlacesLibrary,
  input: string,
  sessionToken: google.maps.places.AutocompleteSessionToken,
  bias?: LatLng,
): Promise<PlaceSuggestion[]> {
  const service = new places.AutocompleteService();
  const request: google.maps.places.AutocompletionRequest = {
    input,
    sessionToken,
  };
  if (bias) {
    request.location = new google.maps.LatLng(bias.lat, bias.lng);
    request.radius = BIAS_RADIUS_M;
  }

  const predictions = await new Promise<
    google.maps.places.AutocompletePrediction[]
  >((resolve) => {
    service.getPlacePredictions(request, (preds, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !preds) {
        resolve([]);
        return;
      }
      resolve(preds);
    });
  });

  return predictions.map((prediction) => ({
    id: prediction.place_id,
    primary: prediction.structured_formatting?.main_text ?? prediction.description,
    secondary: prediction.structured_formatting?.secondary_text ?? undefined,
    label: prediction.description,
    resolve: () =>
      new Promise<ResolvedPlace | null>((resolve) => {
        const detailsService = new places.PlacesService(
          document.createElement("div"),
        );
        detailsService.getDetails(
          {
            placeId: prediction.place_id,
            fields: ["geometry", "formatted_address"],
            sessionToken,
          },
          (place, status) => {
            const loc = place?.geometry?.location;
            if (status !== google.maps.places.PlacesServiceStatus.OK || !loc) {
              resolve(null);
              return;
            }
            resolve({
              lat: loc.lat(),
              lng: loc.lng(),
              label: place?.formatted_address ?? prediction.description,
            });
          },
        );
      }),
  }));
}
