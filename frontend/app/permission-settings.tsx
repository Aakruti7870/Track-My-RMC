import React, { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { usePermissions } from "@/src/permissions/PermissionProvider";
import { requestNearbyPlantsLocationConsent } from "@/src/location/BackgroundLocationConsent";
import { registerPushDevice } from "@/src/notifications/pushClient";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { Card } from "@/src/components/ui/Card";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";

type PermissionState = { status: string; canAskAgain: boolean };
const UNKNOWN: PermissionState = { status: "undetermined", canAskAgain: true };
const labelFor = (value: string) => value === "granted" ? "Allowed" : value === "denied" ? "Denied" : value === "unavailable" ? "Unavailable" : "Not requested";

function PermissionCard({
  icon, title, description, state, buttonLabel, onRequest, busy, reconfirmGranted = false, onSettings,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  state: PermissionState;
  buttonLabel: string;
  onRequest: () => void;
  busy: boolean;
  reconfirmGranted?: boolean;
  onSettings: () => void;
}) {
  const { colors } = useTheme();
  const blocked = state.status === "denied" && !state.canAskAgain;
  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
          <Ionicons name={icon} size={26} color={colors.onBrandSoft} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{title}</AppText>
          <AppText variant="caption">Android permission: {labelFor(state.status)}</AppText>
        </View>
      </View>
      <AppText variant="bodyMuted">{description}</AppText>
      {state.status === "granted" && !reconfirmGranted ? (
        <AppText variant="caption">Permission is enabled. You can change it in Android Settings.</AppText>
      ) : blocked ? (
        <Button label="Open Android settings" variant="outline" disabled={busy} onPress={onSettings} />
      ) : (
        <Button label={buttonLabel} disabled={busy} onPress={onRequest} />
      )}
    </Card>
  );
}

export default function PermissionSettings() {
  const { token, user, hydrating } = useAuth();
  const { enableDiscoveryLocation, locationEnabled } = usePermissions();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [location, setLocation] = useState<PermissionState>(UNKNOWN);
  const [camera, setCamera] = useState<PermissionState>(UNKNOWN);
  const [notification, setNotification] = useState<PermissionState>(UNKNOWN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDriver = user?.role === "driver";

  const refresh = useCallback(async () => {
    if (Platform.OS === "web") {
      setLocation({ status: "unavailable", canAskAgain: false });
      setCamera({ status: "unavailable", canAskAgain: false });
      setNotification({ status: "unavailable", canAskAgain: false });
      return;
    }
    try {
      const [loc, cam, notif] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        ImagePicker.getCameraPermissionsAsync(),
        import("expo-notifications").then(module => module.getPermissionsAsync()),
      ]);
      setLocation({ status: loc.status, canAskAgain: loc.canAskAgain });
      setCamera({ status: cam.status, canAskAgain: cam.canAskAgain });
      setNotification({ status: notif.status, canAskAgain: notif.canAskAgain });
    } catch {
      setError("Permission status could not be read. Check your device settings.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); }
    catch { setError("Android could not update this permission. Check system settings and try again."); }
    finally { await refresh(); setBusy(false); }
  };

  const askLocation = () => void run(async () => {
    // App-owned purpose disclosure must precede the Android location dialog.
    if (!await requestNearbyPlantsLocationConsent()) return;
    const current = await Location.getForegroundPermissionsAsync();
    const result = current.granted || !current.canAskAgain ? current : await Location.requestForegroundPermissionsAsync();
    if (result.granted && user?.role === "customer") await enableDiscoveryLocation();
  });

  const askCamera = () => void run(async () => {
    // Only drivers need the app-owned camera permission for delivery proof.
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (!current.granted && current.canAskAgain) await ImagePicker.requestCameraPermissionsAsync();
  });

  const askNotifications = () => void run(async () => {
    if (token) await registerPushDevice(token, true);
  });

  const openSettings = () => {
    if (Platform.OS === "web") {
      setError("In your browser, use the site permissions control beside the address bar.");
      return;
    }
    void Linking.openSettings().catch(() => setError("Could not open Android settings."));
  };
  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;

  return (
    <ThemedScreen>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <View style={[styles.header, { borderColor: colors.border }]}>
          <Pressable testID="permission-settings-back" onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <AppText variant="title" style={{ flex: 1 }}>App permissions</AppText>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <AppText testID="permission-settings-introduction" variant="bodyMuted">
            TrackMyRMC asks for each Android permission separately, when you enable the related feature. You can decline any optional access and continue using other features.
          </AppText>

          {user.role === "customer" ? (
            <PermissionCard icon="location-outline" title="Location"
              description="Find nearby concrete plants using precise or approximate location while using the app. You can search by city instead. No customer background tracking."
              state={location} buttonLabel="Use location in TrackMyRMC" onRequest={askLocation} busy={busy} reconfirmGranted={!locationEnabled} onSettings={openSettings} />
          ) : (
            <Card style={styles.card}>
              <AppText variant="heading">Location</AppText>
              <AppText variant="bodyMuted">Location access is requested only when you use an assigned trip, attendance, SOS, field visit or plant-location feature. Each action provides its own purpose-specific explanation before the Android prompt.</AppText>
              <AppText variant="caption">Android permission: {labelFor(location.status)}</AppText>
            </Card>
          )}

          {isDriver ? (
            <PermissionCard icon="camera-outline" title="Camera"
              description="Use the camera only when you choose to capture a proof-of-delivery photo. Selecting an existing photo uses Android's photo picker instead."
              state={camera} buttonLabel="Allow camera" onRequest={askCamera} busy={busy} onSettings={openSettings} />
          ) : (
            <Card style={styles.card}>
              <AppText variant="heading">Camera and documents</AppText>
              <AppText variant="bodyMuted">No camera permission is required to browse the app. Android will ask only if a feature actually needs photo capture. Existing files use the system picker.</AppText>
            </Card>
          )}

          <PermissionCard icon="notifications-outline" title="Notifications"
            description="Optional Android alerts for order approvals, dispatch, assigned trips and safety events. Your in-app notification feed remains available if you decline."
            state={notification} buttonLabel="Allow notifications" onRequest={askNotifications} busy={busy} onSettings={openSettings} />

          {isDriver ? <Card style={styles.card}>
            <AppText variant="heading">Background location — active trips only</AppText>
            <AppText variant="bodyMuted">When you begin an assigned delivery trip, TrackMyRMC shows its separate prominent disclosure before Android asks for background location. There is no background permission request on login or on this page.</AppText>
          </Card> : null}
          {error ? <AppText color={colors.error}>{error}</AppText> : null}
          <Button label={Platform.OS === "web" ? "Browser permission help" : "Open Android app settings"} variant="outline" onPress={openSettings} />
          <AppText variant="caption">The Android system controls the precise/approximate location choices, one-time permission and denial buttons. Those options cannot be customized by TrackMyRMC.</AppText>
        </ScrollView>
      </View>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1 },
  back: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  content: { padding: spacing.lg, paddingBottom: 96, gap: spacing.lg, maxWidth: 760, alignSelf: "center", width: "100%" },
  card: { gap: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 52, height: 52, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
});
