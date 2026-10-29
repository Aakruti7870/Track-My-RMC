import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";

import { useAuth } from "@/src/auth/AuthContext";
import { apiGet, apiPut } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

// Existing consent records are retained. The old blocking welcome/permission
// modal is intentionally removed: Android owns the runtime permission sheets,
// and each feature supplies its own purpose-specific disclosure on demand.
const VERSION = 1;
type Choice = "granted" | "denied" | "manual" | "unavailable" | "undetermined";
type Decision = { version: number; location_choice: Choice; notification_choice: Choice };

type PermissionContext = {
  ready: boolean;
  locationEnabled: boolean;
  enableDiscoveryLocation: () => Promise<void>;
  review: () => void;
};

const Permissions = createContext<PermissionContext>({
  ready: true,
  locationEnabled: false,
  enableDiscoveryLocation: async () => undefined,
  review: () => undefined,
});
export const usePermissions = () => useContext(Permissions);

async function isForegroundLocationGranted(): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      if (typeof navigator === "undefined" || !navigator.permissions) return false;
      return (await navigator.permissions.query({ name: "geolocation" })).state === "granted";
    }
    return (await Location.getForegroundPermissionsAsync()).status === "granted";
  } catch {
    return false;
  }
}

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const { token, user, hydrating } = useAuth();
  const router = useRouter();
  const account = user?.role === "customer" ? user.id : null;
  const [locationPreference, setLocationPreference] = useState(false);
  const [runtimeGranted, setRuntimeGranted] = useState(false);
  const [notificationChoice, setNotificationChoice] = useState<Choice>("manual");

  const refreshLocation = useCallback(async () => {
    setRuntimeGranted(await isForegroundLocationGranted());
  }, []);

  // Honor previously saved choices without requesting OS permissions on login.
  // In particular, an existing Android grant alone is NOT consent to turn on
  // automatic customer location discovery.
  useEffect(() => {
    setLocationPreference(false);
    setRuntimeGranted(false);
    setNotificationChoice("manual");
    if (!account || !token) return;
    let cancelled = false;
    void (async () => {
      let decision: Decision | null = null;
      try {
        decision = (await apiGet<{ consent: Decision | null }>("/me/permission-consent", token)).consent;
      } catch {
        const saved = await storage.getItem(`permission-user-${account}`, "");
        try { decision = saved ? JSON.parse(saved) as Decision : null; } catch { /* No saved choice. */ }
      }
      if (cancelled) return;
      setLocationPreference(decision?.location_choice === "granted");
      setNotificationChoice(decision?.notification_choice ?? "manual");
      await refreshLocation();
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [account, token, refreshLocation]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refreshLocation();
    });
    return () => subscription.remove();
  }, [refreshLocation]);

  const enableDiscoveryLocation = async () => {
    // Called after an explicit nearby-plants action and the real OS grant.
    // Never persist a grant merely because the user saw a disclosure.
    const granted = await isForegroundLocationGranted();
    setRuntimeGranted(granted);
    if (!granted) return;
    setLocationPreference(true);
    if (!account || !token || locationPreference) return;
    const decision: Decision = {
      version: VERSION,
      location_choice: "granted",
      notification_choice: notificationChoice,
    };
    try {
      await apiPut("/me/permission-consent", token, decision);
      await storage.setItem(`permission-user-${account}`, JSON.stringify(decision));
    } catch {
      // Feature access remains governed by the real OS permission. The next
      // authenticated session can retry saving preferences.
      await storage.setItem(`permission-user-${account}`, JSON.stringify(decision));
    }
  };

  return (
    <Permissions.Provider value={{
      ready: !hydrating,
      locationEnabled: locationPreference && runtimeGranted,
      enableDiscoveryLocation,
      review: () => router.push("/permission-settings"),
    }}>
      {children}
    </Permissions.Provider>
  );
}
