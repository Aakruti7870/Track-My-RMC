import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import NativeTripLocation from "@/modules/trip-location";
import { storage } from "@/src/utils/storage";
import { requestBackgroundLocationConsent } from "@/src/location/BackgroundLocationConsent";

export const TRIP_LOCATION_TASK = "trackmyrmc-active-trip-location";
const ACTIVE_TRIP_KEY = "tmrmc_active_trip_id";
const TOKEN_KEY = "tmrmc_token";

const activeStatuses = new Set(["EN_ROUTE", "ARRIVED", "AT_SITE", "UNLOADING", "POD_PENDING"]);

function backendBase(): string | null {
  const raw = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

async function postLocation(tripId: string, location: Location.LocationObject): Promise<void> {
  const base = backendBase();
  if (!base || !tripId) return;

  const token = await storage.secureGet<string>(TOKEN_KEY, "");
  if (!token) return;

  const { latitude, longitude, accuracy } = location.coords;
  try {
    await fetch(`${base}/api/driver/trips/${encodeURIComponent(tripId)}/location`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat: latitude,
        lng: longitude,
        accuracy: accuracy ?? undefined,
      }),
    });
  } catch {
    // Foreground/Expo fallback delivery remains best-effort. The native Android
    // service adds an encrypted bounded retry queue when it is available.
  }
}

// TaskManager tasks must be defined at module/global scope so Android can invoke
// them even when no React screen is mounted. This remains as the safe fallback
// for Expo Go/dev clients or if the custom Kotlin module cannot start.
if (!TaskManager.isTaskDefined(TRIP_LOCATION_TASK)) {
  TaskManager.defineTask(TRIP_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data) return;
    const tripId = await storage.getItem<string>(ACTIVE_TRIP_KEY, "");
    if (!tripId) return;

    const payload = data as { locations?: Location.LocationObject[] };
    const latest = payload.locations?.[payload.locations.length - 1];
    if (latest) await postLocation(tripId, latest);
  });
}

export type TrackingStartResult =
  | { mode: "background" }
  | { mode: "foreground"; subscription: Location.LocationSubscription }
  | { mode: "denied" }
  | { mode: "unavailable" };

export function shouldTrackTrip(status?: string | null): boolean {
  return !!status && activeStatuses.has(status);
}

export async function hasBackgroundLocationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const permission = await Location.getBackgroundPermissionsAsync();
    return permission.status === "granted";
  } catch {
    return false;
  }
}

async function startForegroundWatcher(tripId: string): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 15_000,
      distanceInterval: 25,
    },
    (location) => {
      void postLocation(tripId, location);
    },
  );
}

async function startNativeBackgroundTracking(tripId: string): Promise<boolean> {
  if (Platform.OS !== "android" || !NativeTripLocation) return false;

  const base = backendBase();
  const token = await storage.secureGet<string>(TOKEN_KEY, "");
  if (!base?.startsWith("https://") || !token) return false;

  try {
    if (!NativeTripLocation.isAvailable()) return false;
    return await NativeTripLocation.startTracking(tripId, base, token);
  } catch {
    return false;
  }
}

async function stopExpoBackgroundTracking(): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(TRIP_LOCATION_TASK);
    if (registered) await Location.stopLocationUpdatesAsync(TRIP_LOCATION_TASK);
  } catch {
    // Safe during logout, permission changes, or unsupported environments.
  }
}

export async function startTripLocationTracking(
  tripId: string,
  options: { allowBackground?: boolean } = {},
): Promise<TrackingStartResult> {
  if (!tripId || Platform.OS === "web") return { mode: "unavailable" };

  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) return { mode: "unavailable" };

  // IMPORTANT: the caller must show TrackMyRMC's prominent disclosure and get
  // affirmative consent before invoking this function for a trip. This keeps the
  // app-owned disclosure immediately before Android's location runtime prompt.
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") return { mode: "denied" };

  await storage.setItem(ACTIVE_TRIP_KEY, tripId);

  try {
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await postLocation(tripId, current);
  } catch {
    // A watcher may still receive a position shortly afterwards.
  }

  // Background location is requested only after the app-owned prominent
  // disclosure has been accepted. If background permission is refused, the app
  // degrades to foreground-only tracking rather than blocking the delivery.
  if (Platform.OS === "android" && options.allowBackground === true) {
    try {
      const existing = await Location.getBackgroundPermissionsAsync();
      if (existing.status !== "granted") {
        // Google Play requires a prominent in-app disclosure BEFORE the OS
        // background-location prompt. If the driver declines the disclosure,
        // degrade to foreground-only tracking instead of prompting the OS.
        const consented = await requestBackgroundLocationConsent();
        if (!consented) {
          return { mode: "foreground", subscription: await startForegroundWatcher(tripId) };
        }
      }

      const background = await Location.requestBackgroundPermissionsAsync();
      if (background.status === "granted") {
        // Native Kotlin is preferred for production Android builds. It uses a
        // foreground service + FusedLocationProvider and stores retry data in an
        // Android Keystore-encrypted bounded queue. Expo TaskManager remains the
        // fallback so Expo Go/dev clients and failed native starts still work.
        if (await startNativeBackgroundTracking(tripId)) {
          await stopExpoBackgroundTracking();
          return { mode: "background" };
        }

        const taskAvailable = await TaskManager.isAvailableAsync();
        if (taskAvailable) {
          const registered = await TaskManager.isTaskRegisteredAsync(TRIP_LOCATION_TASK);
          if (!registered) {
            await Location.startLocationUpdatesAsync(TRIP_LOCATION_TASK, {
              accuracy: Location.Accuracy.High,
              timeInterval: 15_000,
              distanceInterval: 25,
              deferredUpdatesInterval: 30_000,
              deferredUpdatesDistance: 25,
              foregroundService: {
                notificationTitle: "TrackMyRMC delivery tracking",
                notificationBody: "Mixer location is shared only while your delivery trip is active.",
                killServiceOnDestroy: false,
              },
            });
          }
          return { mode: "background" };
        }
      }
    } catch {
      // Fall back to foreground-only tracking below.
    }
  }

  return { mode: "foreground", subscription: await startForegroundWatcher(tripId) };
}

export async function stopTripLocationTracking(): Promise<void> {
  await storage.removeItem(ACTIVE_TRIP_KEY);

  if (Platform.OS === "android" && NativeTripLocation) {
    try {
      await NativeTripLocation.stopTracking();
    } catch {
      // Continue stopping the Expo fallback even if native cleanup fails.
    }
  }

  await stopExpoBackgroundTracking();
}
