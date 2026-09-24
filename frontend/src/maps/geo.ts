export type LatLng = { lat: number; lng: number };

export function validLatLng(value?: { lat?: number | null; lng?: number | null } | null): value is LatLng {
  return Boolean(
    value &&
      typeof value.lat === "number" &&
      Number.isFinite(value.lat) &&
      value.lat >= -90 &&
      value.lat <= 90 &&
      typeof value.lng === "number" &&
      Number.isFinite(value.lng) &&
      value.lng >= -180 &&
      value.lng <= 180,
  );
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371.0088;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistanceKm(value?: number | null): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value < 1) return `${Math.max(1, Math.round(value * 1000))} m away`;
  if (value < 10) return `${value.toFixed(1)} km away`;
  return `${Math.round(value)} km away`;
}
