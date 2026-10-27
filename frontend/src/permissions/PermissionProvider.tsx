import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState, Linking, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useAuth } from "@/src/auth/AuthContext";
import { apiGet, apiPut, apiErrorDetail } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { registerPushDevice } from "@/src/notifications/pushClient";

/**
 * Version-2 signed-in permission introduction. This is not an OS permission grant:
 * camera and driver background location still require purpose-specific in-app
 * disclosures and runtime permission only when the related feature is used.
 */
const VERSION = 2;
type Choice = "granted" | "denied" | "manual" | "unavailable" | "undetermined";
type Decision = {
  version: number;
  location_choice: Choice;
  notification_choice: Choice;
  camera_choice: Choice;
  updated_at?: string;
};
const Permissions = createContext({
  ready: false,
  locationEnabled: false,
  enableDiscoveryLocation: async () => {},
  review: () => {},
});
export const usePermissions = () => useContext(Permissions);

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const { token, user, hydrating } = useAuth();
  const { colors } = useTheme();
  // Every authenticated account (including Play review fixtures) gets its own
  // choices. There is no pre-OTP device-global modal.
  const account = token && user?.id ? user.id : null;
  const isCustomer = user?.role === "customer";
  const isDriver = user?.role === "driver";
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [needed, setNeeded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<Choice>("manual");
  const [notifications, setNotifications] = useState<Choice>("manual");
  const [camera, setCamera] = useState<Choice>("manual");

  useEffect(() => {
    if (!account || !token) {
      setLoadedFor(null);
      setNeeded(false);
      setReviewing(false);
      return;
    }
    let cancelled = false;
    setLoadedFor(null);
    setError(null);
    setLocation("manual");
    setNotifications("manual");
    setCamera("manual");
    void (async () => {
      let decision: Decision | null = null;
      try {
        decision = (await apiGet<{ consent: Decision | null }>("/me/permission-consent", token)).consent;
      } catch {
        const saved = await storage.getItem(`permission-user-${account}`, "");
        try { decision = saved ? JSON.parse(saved) : null; } catch { /* optional introduction on corrupt cache */ }
      }
      if (cancelled) return;
      setLocation(decision?.location_choice ?? "manual");
      setNotifications(decision?.notification_choice ?? "manual");
      setCamera(decision?.camera_choice ?? "manual");
      setNeeded(decision?.version !== VERSION);
      setLoadedFor(account);
    })();
    return () => { cancelled = true; };
  }, [account, token]);

  // Only after successful OTP/MFA or isolated reviewer authentication.
  const visible = !!account && loadedFor === account && (needed || reviewing);
  const refreshStatuses = async () => {
    if (!isCustomer || Platform.OS === "web") return;
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      setLocation(previous => previous === "granted" ? permission.status as Choice : previous);
    } catch { setLocation(previous => previous === "granted" ? "unavailable" : previous); }
  };
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => {
      if (state === "active" && reviewing) void refreshStatuses();
    });
    return () => listener.remove();
  }, [reviewing, isCustomer]);

  const allowLocation = async () => {
    setBusy(true); setError(null);
    try {
      if (!isCustomer) {
        // Driver and staff location must be requested only for the current
        // delivery, attendance, SOS or plant-onboarding action.
        setLocation("manual");
      } else if (Platform.OS === "web") {
        if (!navigator.geolocation) { setLocation("unavailable"); }
        else await new Promise<void>(resolve => navigator.geolocation.getCurrentPosition(
          () => { setLocation("granted"); resolve(); },
          e => { setLocation(e.code === 1 ? "denied" : "unavailable"); resolve(); },
          { timeout: 12000, maximumAge: 300000 },
        ));
      } else {
        const current = await Location.getForegroundPermissionsAsync();
        const result = current.status === "granted" || !current.canAskAgain
          ? current : await Location.requestForegroundPermissionsAsync();
        setLocation(result.status as Choice);
      }
    } catch(e) { setError(apiErrorDetail(e, "Location is unavailable. You can continue without it.")); }
    finally { setBusy(false); }
  };

  const allowNotifications = async () => {
    setBusy(true); setError(null);
    try {
      if (Platform.OS === "web") {
        if (!("Notification" in window) || !window.isSecureContext) { setNotifications("unavailable"); }
        else {
          const result = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
          setNotifications(result === "default" ? "undetermined" : result as Choice);
        }
      } else {
        const n = await import("expo-notifications");
        await n.setNotificationChannelAsync("default", { name:"TrackMyRMC", importance:n.AndroidImportance.HIGH });
        const current = await n.getPermissionsAsync();
        const result = current.status === "granted" || !current.canAskAgain ? current : await n.requestPermissionsAsync();
        setNotifications(result.status as Choice);
        if (token && result.status === "granted") await registerPushDevice(token);
      }
    } catch { setError("Notifications could not be enabled. You can still check updates within TrackMyRMC."); }
    finally { setBusy(false); }
  };
  const finish = async () => {
    if (!account || !token || busy) return;
    setBusy(true); setError(null);
    const decision: Decision = {
      version: VERSION, location_choice:location, notification_choice:notifications,
      camera_choice:camera, updated_at:new Date().toISOString(),
    };
    try {
      await apiPut("/me/permission-consent",token,decision);
      const stored = await storage.setItem(`permission-user-${account}`,JSON.stringify(decision));
      if (!stored) throw new Error("Preferences could not be stored");
      setNeeded(false); setReviewing(false);
    } catch { setError("Could not save your permission choices. Check your connection and try again. You can keep optional access off."); }
    finally { setBusy(false); }
  };
  const enableDiscoveryLocation = async () => {
    // Existing Nearby Plants flow calls this only following foreground OS grant.
    if (!isCustomer || !account || !token) return;
    setLocation("granted");
    const decision: Decision = { version: VERSION, location_choice:"granted",notification_choice:notifications,camera_choice:camera };
    try {
      await apiPut("/me/permission-consent",token,decision);
      await storage.setItem(`permission-user-${account}`,JSON.stringify(decision));
    } catch { /* Caller still supplies purpose-specific consent before OS permission. */ }
  };
  const introLocation = isCustomer
    ? "Find nearby RMC plants, estimate distance, and show local results while you use the app. You can still search by place or PIN without location. Customers are not tracked in the background."
    : isDriver
      ? "During an assigned delivery, your plant and customer can see mixer position and ETA. Background tracking requires a separate disclosure and your explicit permission at trip start. This introduction does not start tracking."
      : "Location is used only when you explicitly choose a feature such as plant mapping, attendance, site visit or SOS. No continuous tracking starts at login.";

  return <Permissions.Provider value={{
    ready: !hydrating && (!account || (loadedFor === account && !needed)),
    locationEnabled: isCustomer && location === "granted",
    enableDiscoveryLocation,
    review: () => { if (account) { setReviewing(true); void refreshStatuses(); } },
  }}>
    {children}
    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (!busy) void finish(); }}>
      <ScrollView testID="post-otp-permission-introduction"
        contentContainerStyle={{flexGrow:1,padding:20,paddingTop:52,paddingBottom:48,gap:14,backgroundColor:colors.surface}}>
        <View style={{alignItems:"center",gap:8}}>
          <View style={{width:64,height:64,borderRadius:23,alignItems:"center",justifyContent:"center",backgroundColor:colors.brandSoft}}>
            <Ionicons name="shield-checkmark" size={33} color={colors.brand}/>
          </View>
          <AppText variant="title" center>You're in control</AppText>
          <AppText variant="bodyMuted" center>Welcome to TrackMyRMC. Choose how the app may access device features. Each choice is optional and can be changed later.</AppText>
        </View>
        <Card style={{gap:9}}>
          <View style={{flexDirection:"row",alignItems:"center",gap:9}}>
            <Ionicons name="location-outline" size={23} color={colors.brand}/>
            <AppText variant="heading">Location</AppText>
          </View>
          <AppText variant="bodyMuted">{introLocation}</AppText>
          <AppText variant="caption">Current choice: {location}</AppText>
          {isCustomer ?
            <Button testID="intro-allow-location" label="Allow while using the app" loading={busy} onPress={() => void allowLocation()}/> :
            <AppText variant="caption">We will ask again at the relevant feature, not on this screen.</AppText>}
          <Button testID="intro-skip-location" variant="outline" label="Not now" disabled={busy} onPress={() => setLocation("manual")}/>
        </Card>
        <Card style={{gap:9}}>
          <View style={{flexDirection:"row",alignItems:"center",gap:9}}>
            <Ionicons name="camera-outline" size={23} color={colors.brand}/>
            <AppText variant="heading">Camera & photos</AppText>
          </View>
          <AppText variant="bodyMuted">Used only when you choose to capture proof-of-delivery photos or required documents. TrackMyRMC does not access your camera at login. Android photo selection uses the system picker.</AppText>
          <Button testID="intro-camera-on-demand" variant={camera==="manual"?"secondary":"outline"} label="Ask when I use the camera" disabled={busy} onPress={() => setCamera("manual")}/>
          <Button testID="intro-camera-not-now" variant={camera==="denied"?"secondary":"ghost"} label="Not now" disabled={busy} onPress={() => setCamera("denied")}/>
        </Card>
        <Card style={{gap:9}}>
          <View style={{flexDirection:"row",alignItems:"center",gap:9}}>
            <Ionicons name="notifications-outline" size={23} color={colors.brand}/>
            <AppText variant="heading">Delivery notifications</AppText>
          </View>
          <AppText variant="bodyMuted">Optional order updates, dispatch and vehicle arrival alerts. You can check notifications inside the app at any time.</AppText>
          <AppText variant="caption">Current choice: {notifications}</AppText>
          <Button testID="intro-allow-notifications" label="Enable notifications" disabled={busy} onPress={() => void allowNotifications()}/>
          <Button testID="intro-skip-notifications" label="Not now" variant="outline" disabled={busy} onPress={() => setNotifications("manual")}/>
        </Card>
        <Pressable onPress={() => void Linking.openURL("https://trackmyrmc.com/privacy_policy")}
          accessibilityRole="link" style={{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6}}>
          <Ionicons name="document-text-outline" size={16} color={colors.brand}/>
          <AppText color={colors.brand}>Privacy policy</AppText>
        </Pressable>
        {error ? <AppText color={colors.error}>{error}</AppText> : null}
        <Button testID="permission-continue" label="Continue to TrackMyRMC" loading={busy} onPress={() => void finish()}/>
      </ScrollView>
    </Modal>
  </Permissions.Provider>;
}
