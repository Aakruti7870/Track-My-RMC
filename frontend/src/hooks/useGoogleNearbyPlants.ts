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
};

// Google Places content is not cached or written to permanent storage.
// Every response is only retained in React state while the Nearby Plants screen is active.
export function useGoogleNearbyPlants(location: LatLng | null, radiusKm: number, enabled: boolean, query: string, geo: PlantGeoFilters) {
  const { token } = useAuth();
  const lat = location?.lat;
  const lng = location?.lng;
  const searchName = Array.from(query.trim()).slice(0, 80).join("");
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const [state, setState] = useState<{
    data: GoogleNearbyResult | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: false, error: null });

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const id = ++sequence.current;
    if (!token || !enabled || lat == null || lng == null || !validLatLng({ lat, lng })) {
      setState({ data: null, loading: false, error: null });
      return () => { sequence.current++; };
    }
    setState({ data: null, loading: true, error: null });
    // Panning a map or using a manual site selection should not issue every intermediate request.
    const timer = setTimeout(() => {
      void apiPost<GoogleNearbyResult>("/customer/plants/google-nearby", token, {
        lat,
        lng,
        radius_km: Math.min(Math.max(1, radiusKm), 50),
        q: searchName,
        state: geo.state,
        district: geo.district,
        taluka: geo.taluka,
        city: geo.city,
      }).then((result) => {
        if (id === sequence.current) setState({ data: result, loading: false, error: null });
      }).catch((error: unknown) => {
        if (id === sequence.current) {
          setState({ data: null, loading: false, error: apiErrorDetail(error, "Google Places is temporarily unavailable.") });
        }
      });
    }, 700);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [token, lat, lng, radiusKm, enabled, searchName, geo.state, geo.district, geo.taluka, geo.city, revision]);

  return { ...state, refresh };
}
