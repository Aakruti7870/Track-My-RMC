import { Platform } from "react-native";
import * as Location from "expo-location";

import NativeTripLocation from "@/modules/trip-location";
import {
  requestAttendanceLocationConsent,
  requestSosLocationConsent,
  requestForegroundLocationConsent,
  requestNearbyPlantsLocationConsent,
} from "@/src/location/BackgroundLocationConsent";

export type CurrentDeviceLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp?: number;
};

export type CurrentLocationResult =
  | { ok: true; location: CurrentDeviceLocation; source: "native" | "expo" }
  | { ok: false; reason: "permission-denied" | "services-disabled" | "unavailable" };

async function boundedDiscoveryFix<T>(promise: Promise<T>, deadline?: number): Promise<T> {
  if (deadline === undefined) return promise;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Location timed out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Location timed out")), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function getCurrentDeviceLocation(purpose: "attendance" | "sos" | "foreground" | "discovery" = "foreground"): Promise<CurrentLocationResult> {
  if (Platform.OS === "web") return { ok: false, reason: "unavailable" };

  try {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) return { ok: false, reason: "services-disabled" };

    let permission = await Location.getForegroundPermissionsAsync();
    const consented = purpose === "discovery"
      ? permission.status === "granted" || await requestNearbyPlantsLocationConsent()
      : purpose === "attendance"
      ? await requestAttendanceLocationConsent()
      : purpose === "sos"
        ? await requestSosLocationConsent()
        : await requestForegroundLocationConsent();
    if (!consented) return { ok: false, reason: "permission-denied" };

    if (permission.status !== "granted") {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (permission.status !== "granted") {
      return { ok: false, reason: "permission-denied" };
    }

    // One deadline applies to both native and Expo fixes, avoiding two full timeouts.
    const discoveryDeadline = purpose === "discovery" ? Date.now() + 12000 : undefined;
    if (Platform.OS === "android" && NativeTripLocation) {
      try {
        if (NativeTripLocation.isAvailable()) {
          const nativeLocation = await boundedDiscoveryFix(NativeTripLocation.getCurrentLocation(), discoveryDeadline);
          if (
            Number.isFinite(nativeLocation.latitude) &&
            Number.isFinite(nativeLocation.longitude) &&
            nativeLocation.latitude >= -90 &&
            nativeLocation.latitude <= 90 &&
            nativeLocation.longitude >= -180 &&
            nativeLocation.longitude <= 180
          ) {
            return {
              ok: true,
              source: "native",
              location: {
                lat: nativeLocation.latitude,
                lng: nativeLocation.longitude,
                accuracy: nativeLocation.accuracy,
                timestamp: nativeLocation.timestamp,
              },
            };
          }
        }
      } catch {
        // Native location can fail on dev clients or transient Play Services
        // conditions. Fall through to Expo's foreground location API.
      }
    }

    const expoLocation = await boundedDiscoveryFix(Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    }), discoveryDeadline);
    return {
      ok: true,
      source: "expo",
      location: {
        lat: expoLocation.coords.latitude,
        lng: expoLocation.coords.longitude,
        accuracy: expoLocation.coords.accuracy ?? undefined,
        timestamp: expoLocation.timestamp,
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function currentLocationFailureMessage(result: Extract<CurrentLocationResult, { ok: false }>): string {
  if (result.reason === "permission-denied") {
    return "Location permission is required for this action.";
  }
  if (result.reason === "services-disabled") {
    return "Turn on GPS/location services and try again.";
  }
  return "Current device location is unavailable. Try again in a moment.";
}
