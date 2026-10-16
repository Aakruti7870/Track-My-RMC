import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState, Linking, Modal, Platform, ScrollView } from "react-native";
import * as Location from "expo-location";
import { useAuth } from "@/src/auth/AuthContext";
import { apiGet, apiPut, apiErrorDetail } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { registerPushDevice } from "@/src/notifications/pushClient";

const VERSION = 1;
type Choice = "granted" | "denied" | "manual" | "unavailable" | "undetermined";
type Decision = { version: number; location_choice: Choice; notification_choice: Choice; updated_at?: string };
const Permissions = createContext({ ready: false, review: () => {} });
export const usePermissions = () => useContext(Permissions);

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const { token, user, hydrating } = useAuth();
  const { colors } = useTheme();
  const [installReady, setInstallReady] = useState(Platform.OS !== "android");
  const [installNeeded, setInstallNeeded] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [needed, setNeeded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<Choice>("manual");
  const [notifications, setNotifications] = useState<Choice>("manual");
  const account = user?.role === "customer" ? user.id : null;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void storage.getItem<number>("permission-install-version", 0).then(version => {
      setInstallNeeded(version !== VERSION);
      setInstallReady(true);
    });
  }, []);
  useEffect(() => {
    if (!account || !token) { setLoadedFor(null); setNeeded(false); return; }
    let cancelled = false;
    void (async () => {
      let decision: Decision | null = null;
      try { decision = (await apiGet<{consent: Decision | null}>("/me/permission-consent", token)).consent; }
      catch {
        const saved = await storage.getItem(`permission-user-${account}`, "");
        try { decision = saved ? JSON.parse(saved) : null; } catch { /* Show optional introduction on corrupt storage. */ }
      }
      if (cancelled) return;
      setLocation(decision?.location_choice ?? "manual");
      setNotifications(decision?.notification_choice ?? "manual");
      setNeeded(decision?.version !== VERSION);
      setLoadedFor(account);
    })();
    return () => { cancelled = true; };
  }, [account, token]);

  const visible = installReady && (installNeeded || needed || reviewing);
  const refreshStatuses = async () => {
    try { setLocation((await Location.getForegroundPermissionsAsync()).status as Choice); } catch { setLocation("unavailable"); }
  };
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state === "active" && reviewing) void refreshStatuses(); });
    return () => subscription.remove();
  }, [reviewing]);

  const allowLocation = async () => {
    setBusy(true); setError(null);
    try {
      // Browser geolocation is invoked directly by this button gesture.
      if (Platform.OS === "web") {
        if (!navigator.geolocation) { setLocation("unavailable"); return; }
        await new Promise<void>(resolve => navigator.geolocation.getCurrentPosition(
          () => { setLocation("granted"); resolve(); },
          e => { setLocation(e.code === 1 ? "denied" : "unavailable"); resolve(); }, { timeout: 12000, maximumAge: 300000 },
        ));
      } else {
        const current = await Location.getForegroundPermissionsAsync();
        setLocation((current.status === "granted" || !current.canAskAgain ? current : await Location.requestForegroundPermissionsAsync()).status as Choice);
      }
    } catch (e) { setError(apiErrorDetail(e, "Location could not be enabled. You can continue manually.")); }
    finally { setBusy(false); }
  };
  const allowNotifications = async () => {
    setBusy(true); setError(null);
    try {
      if (Platform.OS === "web") {
        if (!("Notification" in window) || !window.isSecureContext) { setNotifications("unavailable"); return; }
        const result = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        setNotifications(result === "default" ? "undetermined" : result);
      } else {
        const module = await import("expo-notifications");
        await module.setNotificationChannelAsync("default", {name:"TrackMyRMC", importance:module.AndroidImportance.HIGH});
        const current = await module.getPermissionsAsync();
        const result = current.status === "granted" || !current.canAskAgain ? current : await module.requestPermissionsAsync();
        setNotifications(result.status as Choice);
        if (token && result.status === "granted") await registerPushDevice(token);
      }
    } catch { setError("Notifications could not be enabled. You can still view order updates in the app."); }
    finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true); setError(null);
    const decision: Decision = { version: VERSION, location_choice: location, notification_choice: notifications, updated_at: new Date().toISOString() };
    try {
      if (account && token) {
        await apiPut("/me/permission-consent", token, decision);
        await storage.setItem(`permission-user-${account}`, JSON.stringify(decision));
      }
      if (Platform.OS === "android") {
        if (!await storage.setItem("permission-install-version", VERSION)) throw new Error("storage");
      }
      setInstallNeeded(false); setNeeded(false); setReviewing(false);
    } catch { setError("Could not save your preferences. Please retry; optional permissions can remain off."); }
    finally { setBusy(false); }
  };
  return <Permissions.Provider value={{ ready: !hydrating && installReady && !installNeeded && (!account || (loadedFor === account && !needed)), review: () => { setReviewing(true); void refreshStatuses(); } }}>
    {children}
    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (!busy) void finish(); }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 56, gap: 20, backgroundColor: colors.surface }}>
        <AppText testID="permission-introduction" variant="title">Welcome to TrackMyRMC</AppText>
        <AppText>Choose what works for you. All permissions below are optional. You can change them later in More → Permission settings.</AppText>
        <Card style={{gap:12}}>
          <AppText variant="heading">Find concrete plants near your site</AppText>
          <AppText>Allow precise or approximate foreground location to find nearby plants and estimate distance. Coordinates are sent to TrackMyRMC for discovery. Customers are never tracked in the background. You can search by city or PIN code instead.</AppText>
          <AppText variant="caption">Location: {location}</AppText>
          <Button label="Allow location" disabled={busy} onPress={allowLocation} />
          <Button label="Not now — choose location manually" disabled={busy} onPress={() => setLocation("manual")} />
        </Card>
        <Card style={{gap:12}}>
          <AppText variant="heading">Keep up with your delivery</AppText>
          <AppText>Optional notifications help with order updates, dispatch, vehicle arrival and delivery. Browser support varies; view updates in the app at any time.</AppText>
          <AppText variant="caption">Notifications: {notifications}</AppText>
          <Button label="Allow notifications" disabled={busy} onPress={allowNotifications} />
          <Button label="Not now" disabled={busy} onPress={() => setNotifications("manual")} />
        </Card>
        <AppText>Camera access is requested only for KYC, document capture or delivery proof. Uploads use the system file/photo picker. Location is not used for advertising. Drivers receive a separate disclosure for assigned active delivery tracking.</AppText>
        <Button label={Platform.OS === "web" ? "Browser settings help" : "Open device Settings"} disabled={busy} onPress={() => Platform.OS === "web" ? setError("Use the site permissions icon beside the address bar to review location and notification access.") : void Linking.openSettings()} />
        {error ? <AppText>{error}</AppText> : null}
        <Button testID="permission-continue" label="Continue with my choices" loading={busy} onPress={finish} />
      </ScrollView>
    </Modal>
  </Permissions.Provider>;
}
