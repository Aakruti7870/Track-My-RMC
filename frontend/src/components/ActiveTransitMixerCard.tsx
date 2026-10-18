import React, { useCallback, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./ui/AppText";
import { LiveMap } from "./LiveMap";
import { DemoTrackingPreview } from "./DemoTrackingPreview";
import { useToast } from "./ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import type { Order } from "@/src/domain/order";
import { fonts } from "@/src/theme/tokens";
import { useTheme } from "@/src/theme/ThemeProvider";
import { DEMO_TRACKING_CARD as demo, trackingCardStrings as t, dialable, freshGPS, selectedLoad, validPoint, type HomeTracking } from "@/src/tracking/homeTracking";

export function ActiveTransitMixerCard({ order, onNewOrder, onRefreshHome }: {
  order: Order | null; onNewOrder: () => void; onRefreshHome: () => Promise<void>;
}) {
  const router = useRouter(); const toast = useToast(); const { colors } = useTheme();
  const [width, setWidth] = useState(0); const [now, setNow] = useState(Date.now());
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
  return <View style={{ gap: 12 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <AppText style={{ fontFamily: fonts.displayBold, fontSize: 20 }}>{t.title}</AppText>
    <View testID={order ? "real-tracking-card" : "demo-tracking-card"} style={[styles.card, { flexDirection: width >= 760 ? "row" : "column", borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <View style={[styles.info, width >= 760 && { width: "34%" }]}>
        <Pressable accessibilityRole="button" disabled={!!order} onPress={onNewOrder} style={{ minHeight: 44, justifyContent: "center" }}><AppText style={styles.title}>{order?.order_number || demo.title}</AppText></Pressable>
        <AppText style={styles.status}>● {order ? order.status.replace(/_/g, " ") : demo.status}</AppText>
        <AppText style={styles.grade}>{order ? `${order.grade} Grade · ${order.quantity} m³` : "M-25 Grade · 6 m³"}</AppText>
        <View style={styles.site}><Ionicons name="location-outline" size={17} color={colors.onSurfaceSecondary} /><AppText style={{ flex: 1 }}>{order?.site_name || demo.siteName}</AppText></View>
        <View style={[styles.metrics, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1 }}><AppText variant="caption">{t.eta}</AppText><AppText style={styles.value}>{!order ? demo.etaLabel : live && load?.route?.eta_text ? load.route.eta_text : t.unavailable}</AppText></View>
          <View style={{ flex: 1 }}><AppText variant="caption">{order ? t.orderedQuantity : t.quantity}</AppText><AppText style={styles.value}>{order?.quantity ?? demo.quantityM3} m³</AppText></View>
        </View>
        <Pressable accessibilityRole="button" accessibilityHint={t.noChallan} testID="home-print-challan" onPress={() => order && tracking?.challan_available ? router.push(`/challan/${order.id}` as any) : toast(t.noChallan, "info")} style={styles.print}><Ionicons name="print-outline" size={20} color={colors.onSurfaceSecondary} /><AppText style={{ fontFamily: fonts.semibold }}>{t.printChallan}</AppText></Pressable>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {!order ? <View><DemoTrackingPreview /><View style={styles.badge}><AppText style={styles.badgeText}>{t.liveTracking}</AppText></View></View> : <>
          <View style={styles.realMap}>
            {location ? <LiveMap origin={validPoint(tracking?.origin) ? tracking.origin : null} destination={validPoint(tracking?.destination) ? tracking.destination : null} mixer={location} polyline={load?.route?.polyline} style={{ flex: 1, minHeight: 0 }} /> : <View style={[styles.waiting, { backgroundColor: colors.surfaceTertiary }]}><Ionicons name="time-outline" size={32} color={colors.brand} /><AppText>{["DELIVERED", "CANCELLED", "REJECTED"].includes(order.status.toUpperCase()) ? order.status.replace(/_/g, " ") : tracking?.active ? t.locationUnavailable : t.waitingForDispatch}</AppText></View>}
          </View>
          <View style={styles.realStatus}>
            <AppText style={{ fontFamily: fonts.semibold }}>{live ? t.liveTracking : location ? t.lastKnown : order.status.replace(/_/g, " ")}</AppText>
            {load?.tm_number ? <AppText>{t.vehicle} · {load.tm_number}{load.driver_name ? ` · ${load.driver_name}` : ""}</AppText> : null}
            {location ? <AppText variant="caption">{new Date(location.at).toLocaleString()} · {location.lat.toFixed(5)}, {location.lng.toFixed(5)}</AppText> : null}
            {error ? <AppText variant="caption">{t.retry}</AppText> : null}
          </View>
        </>}
        <View style={[styles.actions, { backgroundColor: colors.surfaceTertiary }]}>{actions.map(action => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} onPress={action.run} style={[styles.action, { borderColor: colors.border }]}><Ionicons name={action.icon} size={23} color={colors.onSurface} /><AppText style={styles.actionText}>{action.label}</AppText></Pressable>)}</View>
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 24, overflow: "hidden" }, info: { padding: 18, gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 19 }, status: { color: "#B65400", fontFamily: fonts.medium, fontSize: 14 },
  grade: { fontFamily: fonts.semibold, fontSize: 15 }, site: { flexDirection: "row", gap: 5, marginBottom: 12 },
  metrics: { flexDirection: "row", gap: 15, borderTopWidth: 1, borderTopColor: "#EDF0F2", paddingTop: 15 }, value: { fontFamily: fonts.bold, fontSize: 16 },
  print: { flexDirection: "row", gap: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 8 },
  badge: { position: "absolute", top: 10, right: 10, backgroundColor: "#B95100", borderRadius: 7, padding: 7 }, badgeText: { fontFamily: fonts.bold, fontSize: 11, color: "white" },
  actions: { flexDirection: "row", padding: 10, gap: 8, backgroundColor: "transparent" }, action: { flex: 1, minWidth: 0, minHeight: 64, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 5, padding: 4 }, actionText: { fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  realMap: { width: "100%", aspectRatio: 2, overflow: "hidden" }, waiting: { flex: 1, padding: 16, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "transparent" }, realStatus: { gap: 4, padding: 10 },
});
