import React, { useCallback, useState } from "react";
import { AppState, Linking, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./ui/AppText";
import { LiveMap } from "./LiveMap";
import { DemoTrackingPreview } from "./DemoTrackingPreview";
import { useToast } from "./ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import type { Order } from "@/src/domain/order";
import { customerHomeSizes, fonts } from "@/src/theme/tokens";
import { useTheme } from "@/src/theme/ThemeProvider";
import { DEMO_TRACKING_CARD as demo, trackingCardStrings as t, dialable, freshGPS, selectedLoad, validPoint, type HomeTracking } from "@/src/tracking/homeTracking";

export function ActiveTransitMixerCard({ order, onNewOrder, onRefreshHome }: {
  order: Order | null; onNewOrder: () => void; onRefreshHome: () => Promise<void>;
}) {
  const router = useRouter(); const toast = useToast(); const { colors } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const size = customerHomeSizes(viewportWidth, Platform.OS);
  const [mapExpanded, setMapExpanded] = useState(false); const [now, setNow] = useState(Date.now());
  const { data: tracking, error, refetch } = useGet<HomeTracking>(order ? `/customer/orders/${order.id}/tracking` : null);
  useFocusEffect(useCallback(() => {
    let busy = false; let stopped = false;
    const update = async () => {
      if (busy || stopped || AppState.currentState !== "active") return;
      busy = true; setNow(Date.now());
      try { await Promise.all([onRefreshHome(), order && !["DELIVERED", "CANCELLED", "REJECTED"].includes(order.status.toUpperCase()) ? refetch() : Promise.resolve()]); } finally { busy = false; }
    };
    void update(); const timer = setInterval(() => void update(), 15000);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void update(); });
    return () => { stopped = true; clearInterval(timer); listener.remove(); };
  }, [onRefreshHome, refetch, order?.id, order?.status]));
  const load = selectedLoad(tracking);
  const location = validPoint(load?.location) ? load?.location : null;
  const live = !!tracking?.active && !!load?.tm_number && !error && freshGPS(location, now);
  const dial = async (phone?: string | null) => {
    const number = dialable(phone); if (!number) return toast(t.noContact, "info");
    try { await Linking.openURL(`tel:${number}`); } catch { toast(t.noContact, "info"); }
  };
  const actions: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; run: () => void }[] = [
    { label: t.trackTM, icon: "navigate", run: () => order ? router.push(`/track/${order.id}` as any) : toast(t.demoTrack, "info") },
    { label: t.callDriver, icon: "call", run: () => order ? void dial(tracking?.active ? load?.driver_mobile : null) : toast(t.demoDriver, "info") },
    { label: t.callPlant, icon: "business", run: () => order && tracking?.plant_phone ? void dial(tracking.plant_phone) : router.push("/customer/plants") },
  ];
  return <View testID="home-tracking-section" style={{ gap: size.sectionGap, width: "100%", maxWidth: 620, alignSelf: "center" }}>
    <View style={styles.trackingHeading}>
      <AppText style={{ fontFamily: fonts.bold, fontSize: size.headerSize, lineHeight: size.headerLine }}>Track My RMC</AppText>
      <AppText variant="caption" style={{ fontSize: size.serviceLabel, lineHeight: Math.max(17, size.serviceLabelLine) }}>{t.title}</AppText>
    </View>
    <View testID={order ? "real-tracking-card" : "demo-tracking-card"} style={[styles.card, { flexDirection: "column", borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.info}>
        <Pressable accessibilityRole="button" disabled={!!order} onPress={onNewOrder} style={{ minHeight: 26, justifyContent: "center" }}><AppText numberOfLines={1} style={[styles.title, { fontSize: size.headerSize }]}>{order?.order_number || demo.title}</AppText></Pressable>
        <AppText style={[styles.status, { fontSize: Math.max(11, size.serviceLabel) }]}>● {order ? order.status.replace(/_/g, " ") : demo.status}</AppText>
        <AppText style={[styles.grade, { fontSize: Math.max(13, size.serviceLabel) }]}>{order ? `${order.grade} Grade · ${order.quantity} m³` : "M-25 Grade · 6 m³"}</AppText>
        <View style={styles.site}><Ionicons name="location-outline" size={16} color={colors.onSurfaceSecondary} /><AppText numberOfLines={2} style={{ flex: 1, fontSize: 12, lineHeight: 17 }}>{order?.site_name || demo.siteName}</AppText></View>
        <View style={[styles.metrics, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1 }}><AppText variant="caption">{t.eta}</AppText><AppText style={[styles.value, { fontSize: Math.max(13, size.serviceLabel) }]}>{!order ? demo.etaLabel : live && load?.route?.eta_text ? load.route.eta_text : t.unavailable}</AppText></View>
          <View style={{ flex: 1 }}><AppText variant="caption">{order ? t.orderedQuantity : t.quantity}</AppText><AppText style={[styles.value, { fontSize: Math.max(13, size.serviceLabel) }]}>{order?.quantity ?? demo.quantityM3} m³</AppText></View>
        </View>
        {order ? <View style={styles.compactStatus}>
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 12 }}>{live ? t.liveTracking : location ? t.lastKnown : order.status.replace(/_/g, " ")}</AppText>
          {load?.tm_number ? <AppText numberOfLines={1} style={{ fontSize: 12 }}>{t.vehicle} · {load.tm_number}{load.driver_name ? ` · ${load.driver_name}` : ""}</AppText> : null}
          {location ? <AppText variant="caption">{new Date(location.at).toLocaleString()} · {location.lat.toFixed(5)}, {location.lng.toFixed(5)}</AppText> : null}
          {error ? <AppText variant="caption">{t.retry}</AppText> : null}
        </View> : null}
        <Pressable accessibilityRole="button" accessibilityHint={t.noChallan} testID="home-print-challan" onPress={() => order && tracking?.challan_available ? router.push(`/challan/${order.id}` as any) : toast(t.noChallan, "info")} style={styles.print}><Ionicons name="print-outline" size={20} color={colors.onSurfaceSecondary} /><AppText style={{ fontFamily: fonts.semibold }}>{t.printChallan}</AppText></Pressable>
      </View>
      <View style={{ minWidth: 0 }}>
        <Pressable testID="home-toggle-tracking-map" accessibilityRole="button" accessibilityLabel={mapExpanded ? "Hide tracking route" : "View tracking route"}
          onPress={() => setMapExpanded(value => !value)}
          style={[styles.mapToggle, { borderTopColor: colors.border }]}>
          <Ionicons name="map-outline" size={18} color={colors.brand} />
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.onSurface }}>{mapExpanded ? "Hide route map" : "View route map"}</AppText>
          <Ionicons name={mapExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.onSurfaceSecondary} />
        </Pressable>
        {mapExpanded ? (!order ? <View><DemoTrackingPreview /><View style={styles.badge}><AppText style={styles.badgeText}>{t.liveTracking}</AppText></View></View> : <>
          <View style={styles.realMap}>
            {location ? <LiveMap origin={validPoint(tracking?.origin) ? tracking.origin : null} destination={validPoint(tracking?.destination) ? tracking.destination : null} mixer={location} polyline={load?.route?.polyline} style={{ flex: 1, minHeight: 0 }} /> : <View style={[styles.waiting, { backgroundColor: colors.surfaceTertiary }]}><Ionicons name="time-outline" size={32} color={colors.brand} /><AppText>{["DELIVERED", "CANCELLED", "REJECTED"].includes(order.status.toUpperCase()) ? order.status.replace(/_/g, " ") : tracking?.active ? t.locationUnavailable : t.waitingForDispatch}</AppText></View>}
          </View>
        </>) : null}
        <View style={[styles.actions, { backgroundColor: colors.surfaceTertiary }]}>{actions.map(action => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} onPress={action.run} style={[styles.action, { borderColor: colors.border }]}><Ionicons name={action.icon} size={23} color={colors.onSurface} /><AppText style={styles.actionText}>{action.label}</AppText></Pressable>)}</View>
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  trackingHeading: { gap: 1 },
  card: { borderWidth: 1, borderRadius: 18, overflow: "hidden" }, info: { padding: 12, gap: 5 },
  title: { fontFamily: fonts.bold, fontSize: 19 }, status: { color: "#B65400", fontFamily: fonts.medium, fontSize: 14 },
  grade: { fontFamily: fonts.semibold, fontSize: 15 }, site: { flexDirection: "row", gap: 5, marginBottom: 0 },
  metrics: { flexDirection: "row", gap: 15, borderTopWidth: 1, borderTopColor: "#EDF0F2", paddingTop: 10 }, value: { fontFamily: fonts.bold, fontSize: 16 },
  print: { flexDirection: "row", gap: 8, minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 2 },
  compactStatus: { paddingTop: 3, gap: 2 },
  mapToggle: { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderTopWidth: 1 },
  badge: { position: "absolute", top: 10, right: 10, backgroundColor: "#B95100", borderRadius: 7, padding: 7 }, badgeText: { fontFamily: fonts.bold, fontSize: 11, color: "white" },
  actions: { flexDirection: "row", padding: 8, gap: 6, backgroundColor: "transparent" }, action: { flex: 1, minWidth: 0, minHeight: 52, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 5, padding: 4 }, actionText: { fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  realMap: { width: "100%", aspectRatio: 2, minHeight: 150, overflow: "hidden" }, waiting: { flex: 1, padding: 16, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "transparent" }, realStatus: { gap: 4, padding: 10 },
});
