import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { LatLng, validLatLng } from "@/src/maps/geo";
import { PlantGeoFilters } from "@/src/domain/plantGeoFilters";

export type GoogleNearbyPlant = {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distance_km: number;
  google_maps_uri: string | null;
  source: "google_places";
  verified: false;
  order_enabled: false;
};

type GoogleNearbyResult = {
  places: GoogleNearbyPlant[];
  attribution: string;
  radius_km: number;
  source: "google_places";
  next_page_token?: string | null;
};

type Pagination = { key: string; page: number; tokens: (string | null)[] };

// Google Places content is not cached or written to permanent storage.
// Only opaque pagination tokens are retained in memory for the current query.
// Previous pages are fetched again when navigated back to.
export function useGoogleNearbyPlants(location: LatLng | null, radiusKm: number, enabled: boolean, query: string, geo: PlantGeoFilters) {
  const { token } = useAuth();
  const lat = location?.lat;
  const lng = location?.lng;
  const searchName = Array.from(query.trim()).slice(0, 80).join("");
  // Changing the search center, search term, location fields, radius, or login
  // must start again at page 1 with a fresh Google continuation token chain.
  const key = JSON.stringify([token, lat, lng, radiusKm, enabled, searchName, geo.state, geo.district, geo.taluka, geo.city]);
  const [pagination, setPagination] = useState<Pagination>({ key, page: 1, tokens: [null] });
  const currentPagination = pagination.key === key ? pagination : { key, page: 1, tokens: [null] };
  const page = currentPagination.page;
  const pageToken = currentPagination.tokens[page - 1] ?? null;
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const [state, setState] = useState<{
    key: string;
    page: number;
    data: GoogleNearbyResult | null;
    loading: boolean;
    error: string | null;
  }>({ key: "", page: 1, data: null, loading: false, error: null });

  const canSearch = Boolean(token && enabled && lat != null && lng != null && validLatLng({ lat, lng }));
  const current = state.key === key && state.page === page;
  const refresh = useCallback(() => {
    setPagination({ key, page: 1, tokens: [null] });
    setRevision(value => value + 1);
  }, [key]);
  const nextPage = useCallback(() => {
    const continuation = current && !state.loading ? state.data?.next_page_token : null;
    if (!continuation) return;
    setPagination(previous => {
      const active = previous.key === key ? previous : { key, page: 1, tokens: [null] };
      return { key, page: active.page + 1, tokens: [...active.tokens.slice(0, active.page), continuation] };
    });
  }, [current, key, state.data?.next_page_token, state.loading]);
  const previousPage = useCallback(() => {
    setPagination(previous => {
      if (previous.key !== key || previous.page <= 1) return previous;
      return { ...previous, page: previous.page - 1 };
    });
  }, [key]);

  useEffect(() => {
    const id = ++sequence.current;
    if (!canSearch || lat == null || lng == null) {
      setState({ key, page, data: null, loading: false, error: null });
      return () => { sequence.current++; };
    }
    setState({ key, page, data: null, loading: true, error: null });
    // Panning a map or using a manual site selection should not issue
    // intermediate requests. Clicking Next/Previous triggers one page request.
    const timer = setTimeout(() => {
      void apiPost<GoogleNearbyResult>("/customer/plants/google-nearby", token!, {
        lat,
        lng,
        radius_km: Math.min(Math.max(1, radiusKm), 50),
        q: searchName,
        state: geo.state,
        district: geo.district,
        taluka: geo.taluka,
        city: geo.city,
        ...(pageToken ? { page_token: pageToken } : {}),
      }).then(result => {
        if (id === sequence.current) setState({ key, page, data: result, loading: false, error: null });
      }).catch((error: unknown) => {
        if (id === sequence.current) {
          setState({ key, page, data: null, loading: false, error: apiErrorDetail(error, "Google Places is temporarily unavailable.") });
        }
      });
    }, 700);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [key, page, pageToken, revision, canSearch, token, lat, lng, radiusKm, searchName, geo.state, geo.district, geo.taluka, geo.city]);

  return {
    data: current ? state.data : null,
    loading: canSearch && (!current || state.loading),
    error: current ? state.error : null,
    refresh,
    page,
    nextPage,
    previousPage,
    hasNextPage: current && Boolean(state.data?.next_page_token),
    hasPreviousPage: page > 1,
  };
}
