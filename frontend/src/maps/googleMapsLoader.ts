// One Maps JavaScript API load per browser document, without an iframe.
import type { LatLng } from "./geo";

type Listener = { remove(): void };
export type MapsMap = {
  addListener(name: string, handler: () => void): Listener;
  getCenter(): { toJSON(): LatLng } | undefined;
  getZoom(): number;
  setZoom(zoom: number): void;
  panTo(center: LatLng): void;
};
export type MapsMarker = {
  setMap(map: MapsMap | null): void;
  addListener(name: string, handler: () => void): Listener;
};
export type MapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapsMap;
  Marker: new (options: Record<string, unknown>) => MapsMarker;
  event: { clearInstanceListeners(instance: MapsMap | MapsMarker): void };
};
declare global {
  interface Window {
    google?: { maps: MapsApi };
    gm_authFailure?: () => void;
    __trackMyRmcMapsReady?: () => void;
  }
}
let pending: Promise<MapsApi> | null = null;
let authenticationFailed = false;
let installed = false;
const failures = new Set<() => void>();
export function onMapsAuthFailure(handler: () => void): () => void {
  failures.add(handler);
  if (authenticationFailed) handler();
  return () => { failures.delete(handler); };
}
export function loadGoogleMaps(key: string): Promise<MapsApi> {
  if (!key) return Promise.reject(new Error("MAPS_KEY_MISSING"));
  if (!installed) {
    installed = true;
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => {
      authenticationFailed = true;
      failures.forEach(handler => handler());
      previous?.();
    };
  }
  if (authenticationFailed) return Promise.reject(new Error("MAPS_AUTH_FAILED"));
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (pending) return pending;
  pending = new Promise<MapsApi>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => fail(), 20000);
    function fail() {
      window.clearTimeout(timer);
      delete window.__trackMyRmcMapsReady;
      script.remove();
      reject(new Error("MAPS_LOAD_FAILED"));
    }
    window.__trackMyRmcMapsReady = () => {
      window.clearTimeout(timer);
      delete window.__trackMyRmcMapsReady;
      if (window.google?.maps?.Map && !authenticationFailed) resolve(window.google.maps);
      else fail();
    };
    const params = new URLSearchParams({
      key, v: "quarterly", loading: "async",
      callback: "__trackMyRmcMapsReady", auth_referrer_policy: "origin",
    });
    script.id = "trackmyrmc-google-maps";
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return pending;
}
