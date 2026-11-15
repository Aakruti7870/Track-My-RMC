import { apiGet } from "./client";

export type PlacePrediction = { place_id: string; description: string };
export type PlaceDetails = { place_id: string; address: string; lat: number; lng: number };

export async function predictPlaces(input: string, token: string, signal?: AbortSignal) {
  const { predictions } = await apiGet<{ success: true; predictions: PlacePrediction[] }>(
    `/maps/autocomplete?input=${encodeURIComponent(input)}`, token, signal,
  );
  return predictions;
}

export function getPlaceDetails(placeId: string, token: string, signal?: AbortSignal) {
  return apiGet<PlaceDetails>(`/maps/place/${encodeURIComponent(placeId)}`, token, signal);
}
