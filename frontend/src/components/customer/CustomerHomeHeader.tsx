import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, ClipPath, Defs, G, Line, Rect } from "react-native-svg";

import { apiGet, apiErrorDetail } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { getCurrentDeviceLocation, currentLocationFailureMessage } from "@/src/location/currentLocation";
import { usePermissions } from "@/src/permissions/PermissionProvider";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { customerHomeSizes, fonts, glass } from "@/src/theme/tokens";

type Sheet = "help" | "location" | null;
type Geocode = { locality: string; formatted_address: string };

function IndianFlag({ size }: { size: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Defs><ClipPath id="headerFlag"><Circle cx="12" cy="12" r="11" /></ClipPath></Defs>
    <G clipPath="url(#headerFlag)">
      <Rect width="24" height="8" fill="#FF9933" /><Rect y="8" width="24" height="8" fill="#FFFFFF" /><Rect y="16" width="24" height="8" fill="#138808" />
      <Circle cx="12" cy="12" r="3" fill="none" stroke="#000080" strokeWidth="0.6" />
      {Array.from({ length: 12 }, (_, i) => <Line key={i} x1="12" y1="12" x2={12 + 3 * Math.cos(i * Math.PI / 6)} y2={12 + 3 * Math.sin(i * Math.PI / 6)} stroke="#000080" strokeWidth="0.35" />)}
    </G><Circle cx="12" cy="12" r="11" fill="none" stroke="#FFFFFF" strokeWidth="0.7" />
  </Svg>;
}

// One-shot lookups only: this header never starts a location watcher or background task.
async function deviceCoordinates(): Promise<{ lat: number; lng: number }> {
  if (Platform.OS === "web") {
    if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error("Location is unavailable in this browser. Select a city manually.");
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      error => reject(new Error(error.code === 1 ? "Location permission was denied. Select a city manually." : "Location is unavailable or timed out. Please retry or select a city.")),
      { timeout: 12000, maximumAge: 300000, enableHighAccuracy: false },
    ));
  }
  const result = await getCurrentDeviceLocation("discovery");
  if (!result.ok) throw new Error(currentLocationFailureMessage(result));
  return result.location;
}

export function CustomerHomeHeader({ onRefreshHome }: { onRefreshHome: () => Promise<void> }) {
  const { token } = useAuth();
  const { colors, scheme, toggle } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const size = customerHomeSizes(width, Platform.OS);
  const focused = useIsFocused();
  const permissions = usePermissions();
  const { data: feed, error: feedError, refetch: refreshFeed } = useGet<{ unread: number }>("/notifications?limit=1");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selection, setSelection] = useState<{ token: string; label: string } | null>(null);
  const [manual, setManual] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const request = useRef(0);
  const attemptedFor = useRef<string | null>(null);
  const busy = useRef(false);
  const locationController = useRef<AbortController | null>(null);
  const unread = !feedError && typeof feed?.unread === "number" && feed.unread > 0;
  const label = selection?.token === token ? selection.label : "Select Location";

  const refresh = useCallback(() => {
    void refreshFeed();
  }, [refreshFeed]);

  useFocusEffect(useCallback(() => {
    refresh();
    void onRefreshHome();
    const visible = () => AppState.currentState === "active" && (Platform.OS !== "web" || document.visibilityState === "visible");
    const interval = setInterval(() => { if (visible()) refresh(); }, 30000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    if (Platform.OS === "web") document.addEventListener("visibilitychange", onVisible);
    let disposed = false;
    let removePush: (() => void) | undefined;
    if (Platform.OS === "android") {
      void import("expo-notifications").then(module => {
        if (!disposed) {
          const listener = module.addNotificationReceivedListener(refresh);
          removePush = () => listener.remove();
        }
      }).catch(() => undefined);
    }
    return () => {
      disposed = true;
      clearInterval(interval);
      subscription.remove();
      removePush?.();
      if (Platform.OS === "web") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, onRefreshHome]));

  const cancelLocation = useCallback(() => {
    request.current++;
    busy.current = false;
    locationController.current?.abort();
  }, []);

  useEffect(() => {
    setSheet(null);
    setSelection(null);
    setManual("");
    setLocationBusy(false);
    setLocationError(null);
    return cancelLocation;
  }, [token, cancelLocation]);

  const lookup = useCallback(async (address?: string) => {
    if (!token || busy.current) return;
    const id = ++request.current;
    busy.current = true;
    setLocationBusy(true);
    setLocationError(null);
    const controller = new AbortController();
    locationController.current = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const coordinates = address ? null : await deviceCoordinates();
      if (id !== request.current || controller.signal.aborted) return;
      timeout = setTimeout(() => controller.abort(), 15000);
      const query = address ? `address=${encodeURIComponent(address)}` : `lat=${coordinates!.lat}&lng=${coordinates!.lng}`;
      const result = await apiGet<Geocode>(`/maps/geocode?${query}`, token, controller.signal);
      if (!result.locality?.trim()) throw new Error("Could not resolve a city. Select a location manually.");
      if (id !== request.current) return;
      setSelection({ token, label: result.locality });
      setSheet(null);
    } catch (error) {
      if (id === request.current) {
        setLocationError(controller.signal.aborted ? "Location lookup timed out. Please retry." : apiErrorDetail(error, error instanceof Error ? error.message : "Could not find location. Please retry."));
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (id === request.current) { busy.current = false; setLocationBusy(false); }
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    // Respect the existing post-login consent choice; do not prompt on every Home visit.
    if (focused && token && permissions.ready && permissions.locationEnabled && attemptedFor.current !== token) {
      attemptedFor.current = token;
      // Checking runtime permission does not prompt. A revoked/undecided permission
      // is requested only from the dropdown's explicit refresh action.
      void (async () => {
        const granted = Platform.OS === "web"
          ? typeof navigator !== "undefined" && !!navigator.permissions && (await navigator.permissions.query({ name: "geolocation" })).state === "granted"
          : (await Location.getForegroundPermissionsAsync()).status === "granted";
        if (active && granted) await lookup();
      })().catch(() => undefined);
    }
    return () => { active = false; };
  }, [focused, token, permissions.ready, permissions.locationEnabled, lookup]);

  const close = () => setSheet(null);
  const glassSurface = colors.isDark ? glass.darkSurface : glass.lightSurface;
  const glassBorder = colors.isDark ? glass.darkBorder : glass.lightBorder;
  return <>
    {focused ? <StatusBar style={colors.isDark ? "light" : "dark"} /> : null}
    <View style={[styles.safeArea, { paddingTop: insets.top, backgroundColor: glassSurface, borderColor: glassBorder, shadowColor: colors.shadow }]}>
      <View testID="customer-home-header" style={[styles.row, { minHeight: size.headerHeight }]}>
        <Pressable testID="header-location-chevron" accessibilityRole="button" accessibilityLabel="Choose location"
          accessibilityHint="Opens the location selector and refresh options"
          onPress={() => setSheet("location")} style={[styles.target, { width: size.headerTarget, minHeight: Math.max(44, size.headerTarget) }]}>
          <Ionicons name="chevron-down" size={size.headerChevron} color={colors.onSurface} />
        </Pressable>
        <Pressable testID="header-location" accessibilityRole="button" accessibilityLabel={`Location: ${label}. Select location`} onPress={() => setSheet("location")} style={[styles.location, { minHeight: Math.max(44, size.headerTarget) }]}>
          <IndianFlag size={size.headerFlag} />
          <AppText numberOfLines={1} ellipsizeMode="tail" style={[styles.locationText, { fontSize: size.locationSize, lineHeight: size.locationLine, color: colors.onSurface }]}>{locationBusy ? "Locating…" : label}</AppText>
        </Pressable>
        <Pressable testID="notifications-bell" accessibilityRole="button" accessibilityLabel={unread ? `${feed!.unread} unread notifications` : "Notifications"} onPress={() => router.push("/notifications")} style={[styles.target, { width: size.headerTarget, minHeight: Math.max(44, size.headerTarget) }]}>
          <Ionicons name="notifications-outline" size={size.headerBell} color={colors.onSurface} />
          {unread ? <View testID="header-unread-dot" style={[styles.dot, { backgroundColor: colors.verified, borderColor: glassSurface }]} /> : null}
        </Pressable>
        <Pressable testID="header-theme" accessibilityRole="button" accessibilityLabel="Switch light or dark mode"
          onPress={toggle} style={[styles.target, { width: size.headerTarget, minHeight: Math.max(44, size.headerTarget) }]}>
          <Ionicons name={scheme === "dark" ? "sunny-outline" : "moon-outline"} size={size.headerBell} color={colors.onSurface} />
        </Pressable>
        <Pressable testID="header-help" accessibilityRole="button" accessibilityLabel="Customer help" onPress={() => setSheet("help")} style={[styles.target, { width: size.headerTarget, minHeight: Math.max(44, size.headerTarget) }]}>
          <Ionicons name="help-circle-outline" size={size.headerHelp} color={colors.onSurface} />
        </Pressable>
      </View>
    </View>
    <Modal transparent visible={sheet !== null} animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close dialog" onPress={close} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.sheet, { backgroundColor: glassSurface, borderColor: glassBorder, shadowColor: colors.shadow, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetTitle}>
            <AppText variant="heading">{sheet === "help" ? "Customer Help" : "Choose Location"}</AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Close dialog" onPress={close} style={[styles.target, { width: size.headerTarget, minHeight: Math.max(44, size.headerTarget) }]}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
            {sheet === "help" ? <>
              <Button label="Customer Support" onPress={() => { close(); router.push("/support"); }} />
              <Button label="Delete Account" variant="outline" onPress={() => { close(); router.push("/account-deletion"); }} />
            </> : <>
              <AppText>Use your location once, or search for a city or locality.</AppText>
              <Button label="Refresh current location" disabled={locationBusy} onPress={() => void lookup()} />
              <Input label="City, locality or PIN code" testID="header-manual-location" value={manual} onChangeText={setManual} maxLength={200} editable={!locationBusy} />
              <Button label="Use selected location" disabled={locationBusy || manual.trim().length < 3} onPress={() => void lookup(manual.trim())} />
              {locationBusy ? <ActivityIndicator accessibilityLabel="Finding location" color={colors.brand} /> : null}
              {locationError ? <AppText accessibilityLiveRegion="polite" color={colors.error}>{locationError}</AppText> : null}
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  safeArea: { borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.10, shadowRadius: 18, elevation: 3 },
  row: { width: "100%", maxWidth: 1100, alignSelf: "center", minHeight: 52, paddingHorizontal: 8, flexDirection: "row", alignItems: "center" },
  target: { width: 44, minHeight: 44, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  location: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", gap: 6, alignItems: "center", paddingHorizontal: 4 },
  locationText: { flex: 1, minWidth: 0, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  dot: { position: "absolute", top: 8, right: 9, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: glass.overlay },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "85%", alignSelf: "center", borderWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 6 },
  sheetTitle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetContent: { gap: 14, paddingBottom: 8 },
});
