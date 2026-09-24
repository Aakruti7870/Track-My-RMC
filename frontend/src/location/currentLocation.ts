import { Platform } from "react-native";
import * as Location from "expo-location";

import NativeTripLocation from "@/modules/trip-location";

export type CurrentDeviceLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp?: number;
};

export type CurrentLocationResult =
  | { ok: true; location: CurrentDeviceLocation; source: "native" | "expo" }
  | { ok: false; reason: "permission-denied" | "services-disabled" | "unavailable" };

export async function getCurrentDeviceLocation(): Promise<CurrentLocationResult> {
  if (Platform.OS === "web") return { ok: false, reason: "unavailable" };

  try {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) return { ok: false, reason: "services-disabled" };

    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (permission.status !== "granted") {
      return { ok: false, reason: "permission-denied" };
    }

    if (Platform.OS === "android" && NativeTripLocation) {
      try {
        if (NativeTripLocation.isAvailable()) {
          const nativeLocation = await NativeTripLocation.getCurrentLocation();
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

    const expoLocation = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
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
