import React, { useCallback, useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Location from "expo-location";

import { apiGet } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { getCurrentDeviceLocation } from "@/src/location/currentLocation";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { fonts } from "@/src/theme/tokens";

type Geocode = { locality?: string };
const HELP: Record<string, string> = {
  driver: "Trip assignment, proof of delivery, emergency assistance and vehicle records.",
  plant_owner: "Plant operations, staff access, approvals and dispatch controls.",
  admin: "Orders, fleet and delegated plant management.",
  dispatcher: "Load assignment, delivery schedule and available transit mixers.",
  operator: "Batching operations, production queues and approved mix designs.",
  supervisor: "Plant supervision, incidents and workforce exceptions.",
  accountant: "Invoices, reconciliation, payroll and plant accounts.",
  quality_engineer: "Mix designs, quality tests and inspection records.",
  fleet_manager: "Mixer assignment, transport fleet and driver activity.",
  store_manager: "Material inventory, suppliers, deliveries and stock levels.",
};

export function OperationalHomeTopBar() {
  const { token, user } = useAuth();
  const { colors, toggle, scheme } = useTheme();
  const router = useRouter();
  const { data: notifications, refetch: refreshNotifications } = useGet<{ unread: number }>("/notifications?limit=1");
  const [location, setLocation] = useState("Current location");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [request, setRequest] = useState(0);

  const refreshLocation = useCallback(async () => {
    if (!token || busy) return;
    setBusy(true);
    setMessage("");
    try {
      let lat: number;
      let lng: number;
      if (Platform.OS === "web") {
        if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error("Location not supported in this browser");
        const result = await new Promise<{ lat: number; lng: number }>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => reject(new Error("Location permission unavailable")),
            { timeout: 12000, maximumAge: 300000 }
          )
        );
        lat = result.lat; lng = result.lng;
      } else {
        const result = await getCurrentDeviceLocation("discovery");
        if (!result.ok) throw new Error("Enable foreground location to refresh");
        lat = result.location.lat; lng = result.location.lng;
      }
      const response = await apiGet<Geocode>(`/maps/geocode?lat=${lat}&lng=${lng}`, token);
      if (!response.locality?.trim()) throw new Error("Location name unavailable");
      setLocation(response.locality);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to get current location");
    } finally {
      setBusy(false);
    }
  }, [busy, token]);

  useEffect(() => {
    setLocation("Current location");
    setMessage("");
    setRequest(value => value + 1);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    // Auto-resolve only after consent is already granted; never request
    // runtime permission simply because the home screen rendered.
    void (async () => {
      const permitted = Platform.OS === "web"
        ? typeof navigator !== "undefined" && !!navigator.permissions &&
          (await navigator.permissions.query({ name: "geolocation" })).state === "granted"
        : (await Location.getForegroundPermissionsAsync()).status === "granted";
      if (active && permitted) void refreshLocation();
    })().catch(() => undefined);
    return () => { active = false; };
    // The request counter is changed only on account changes, not on location refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, request]);

  useFocusEffect(useCallback(() => {
    void refreshNotifications();
  }, [refreshNotifications]));

  const helpText = HELP[user?.role === "owner" ? "plant_owner" : (user?.role || "")] || "Role-specific tasks and account support.";
  const unread = notifications?.unread || 0;
  const glass = colors.surfaceSecondary;
  return <>
    <View testID="operational-home-top-bar" style={[styles.row, { backgroundColor: glass, borderColor: colors.border }]}>
      <Pressable testID="operational-location-refresh" accessibilityRole="button" accessibilityLabel="Refresh current location"
        onPress={() => void refreshLocation()} disabled={busy} style={styles.target}>
        <Ionicons name="chevron-down" size={23} color={colors.onSurface} />
      </Pressable>
      <Pressable onPress={() => void refreshLocation()} accessibilityRole="button" accessibilityLabel="Current location, refresh"
        style={styles.location}>
        <Ionicons name="location-outline" size={17} color={colors.brand} />
        <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.onSurface, flexShrink: 1 }}>
          {busy ? "Locating…" : location}
        </AppText>
      </Pressable>
      <Pressable testID="operational-notifications" accessibilityRole="button" accessibilityLabel={`Notifications, ${unread} unread`}
        onPress={() => router.push("/notifications")} style={styles.target}>
        <Ionicons name="notifications-outline" size={22} color={colors.onSurface} />
        {unread > 0 ? <View style={[styles.dot, { backgroundColor: colors.brand }]} /> : null}
      </Pressable>
      <Pressable testID="operational-theme" accessibilityRole="button" accessibilityLabel="Switch light or dark mode"
        onPress={toggle} style={styles.target}>
        <Ionicons name={scheme === "dark" ? "sunny-outline" : "moon-outline"} size={22} color={colors.onSurface} />
      </Pressable>
      <Pressable testID="operational-help" accessibilityRole="button" accessibilityLabel="Help for your role"
        onPress={() => setHelpOpen(true)} style={styles.target}>
        <Ionicons name="help-circle-outline" size={23} color={colors.onSurface} />
      </Pressable>
    </View>
    {!!message ? <AppText accessibilityLiveRegion="polite" style={{ paddingHorizontal: 16, color: colors.onSurfaceSecondary, fontSize: 11 }}>{message}</AppText> : null}
    <Modal transparent visible={helpOpen} animationType="fade" onRequestClose={() => setHelpOpen(false)}>
      <View style={styles.scrim}>
        <View style={[styles.help, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <AppText variant="heading">Role Help</AppText>
          <AppText variant="bodyMuted">{helpText}</AppText>
          <Pressable accessibilityRole="button" onPress={() => { setHelpOpen(false); router.push("/support"); }} style={styles.helpAction}>
            <Ionicons name="help-circle-outline" size={20} color={colors.brand} />
            <AppText color={colors.brand}>Open Support</AppText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setHelpOpen(false)} style={styles.helpAction}>
            <AppText color={colors.onSurface}>Close</AppText>
          </Pressable>
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  row: { minHeight: 54, paddingHorizontal: 5, borderWidth: 1, borderRadius: 14, marginHorizontal: 12, marginVertical: 6, flexDirection: "row", alignItems: "center" },
  target: { width: 43, height: 44, alignItems: "center", justifyContent: "center" },
  location: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 3 },
  dot: { position: "absolute", right: 7, top: 6, width: 8, height: 8, borderRadius: 4 },
  scrim: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.55)" },
  help: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 14 },
  helpAction: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
});
