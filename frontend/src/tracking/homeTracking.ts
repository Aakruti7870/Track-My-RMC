// Presentation only. Never sent to the order or telemetry APIs.
export const trackingCardStrings = {
  title: "Active Transit Mixer Live Tracking", firstOrder: "Place Your First order",
  demoSite: "Project site 1", dispatched: "Dispatched", grade: "M-25 Grade",
  eta: "ETA", live: "Live", quantity: "Quantity", printChallan: "Print Challan",
  liveTracking: "LIVE TRACKING", trackTM: "Track TM", callDriver: "Call Driver",
  callPlant: "Call Plant", enRoute: "En Route", waitingForDispatch: "Waiting for dispatch",
  locationUnavailable: "Vehicle location unavailable", trackingUnavailable: "Live tracking is not available yet",
  demo: "DEMO · illustrative route", demoTrack: "Demonstration only. Live tracking becomes available after dispatch.",
  demoDriver: "Driver contact becomes available after assignment.",
  noChallan: "A challan becomes available once the plant issues it for your order.",
  lastKnown: "Last known location", unavailable: "Unavailable", orderedQuantity: "Ordered quantity",
  vehicle: "Transit Mixer", noContact: "Contact number not available for this trip",
  mapLabel: "Delivery tracking", retry: "Connection interrupted — retrying", viewAll: "View All ›",
} as const;
export const DEMO_TRACKING_CARD = {
  mode: "demo", title: trackingCardStrings.firstOrder, status: "Dispatched",
  gradeLabel: "M-25 Grade", quantityM3: 6, siteName: "Project site 1", etaLabel: "Live",
  vehicleLabel: "Transit Mixer", vehicleNumber: "TM-08", vehicleStatus: "En Route",
  trackingBadge: "LIVE TRACKING", mapReferenceWidth: 800, mapReferenceHeight: 400,
} as const;
export type Point = { lat: number; lng: number };
export type GPS = Point & { at: string };
export type TrackedLoad = {
  id: string; status: string; tm_number?: string; driver_name?: string; driver_mobile?: string;
  location?: GPS | null; route?: { eta_text?: string; polyline?: string } | null;
};
export type HomeTracking = {
  active: boolean; status: string; active_loads?: TrackedLoad[];
  origin?: Point; destination?: Point; plant_phone?: string | null; challan_available?: boolean;
};
export function validPoint(point?: Point | null): point is Point {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}
export function freshGPS(location: GPS | null | undefined, now: number): boolean {
  const age = now - Date.parse(location?.at || "");
  return validPoint(location) && Number.isFinite(age) && age >= 0 && age < 90000;
}
// Keep identity, contact and GPS on one load; never combine fields across mixers.
export function selectedLoad(tracking: HomeTracking | null): TrackedLoad | undefined {
  return tracking?.active_loads?.[0];
}
export function dialable(number?: string | null): string | null {
  const clean = number?.replace(/[\s()-]/g, "") || "";
  return /^\+?[0-9]{7,15}$/.test(clean) ? clean : null;
}
