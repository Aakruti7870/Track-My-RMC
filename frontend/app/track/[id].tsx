import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { LiveMap } from "@/src/components/LiveMap";
import { ErrorView } from "@/src/components/StateViews";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type RouteInfo = {
  eta_seconds: number;
  eta_text: string;
  distance_m: number;
  distance_text: string;
  polyline?: string;
};
type Location = { lat: number; lng: number; at: string };
type TrackedLoad = {
  id: string;
  load_code?: string;
  load_number?: number;
  quantity_m3?: number;
  status: string;
  tm_number?: string;
  driver_name?: string;
  driver_mobile?: string;
  delivered_quantity?: number;
  location: Location | null;
  route?: RouteInfo | null;
};
type Track = {
  active: boolean;
  status: string;
  tm_number?: string;
  driver_name?: string;
  driver_mobile?: string;
  destination: { site_name: string; address?: string; lat?: number; lng?: number };
  location: Location | null;
  route?: RouteInfo | null;
  active_loads?: TrackedLoad[];
  loads?: TrackedLoad[];
};

export default function TrackScreen() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, refetch, reload } = useGet<Track>(`/customer/orders/${id}/tracking`);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.active) return;
    const t = setInterval(() => refetch(), 15000);
    return () => clearInterval(t);
  }, [data?.active, refetch]);

  useEffect(() => {
    const active = data?.active_loads || [];
    if (!active.length) return;
    if (!selectedId || !active.some((l) => l.id === selectedId)) setSelectedId(active[0].id);
  }, [data?.active_loads, selectedId]);

  const selected = useMemo(
    () => data?.active_loads?.find((l) => l.id === selectedId) || data?.active_loads?.[0] || null,
    [data?.active_loads, selectedId],
  );
  const mapLocation = selected?.location || data?.location || null;
  const route = selected?.route || data?.route || null;
  const tm = selected?.tm_number || data?.tm_number;
  const driver = selected?.driver_name || data?.driver_name;
  const driverMobile = selected?.driver_mobile || data?.driver_mobile;
  const liveStatus = selected?.status || data?.status || "PENDING";

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="track-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">Live Tracking</AppText>
      </View>
      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : loading && !data ? (
        <View style={{ padding: spacing.lg }}><Skeleton height={320} style={{ borderRadius: radius.lg }} /></View>
      ) : data ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          {(data.active_loads?.length || 0) > 1 ? (
            <View style={{ gap: spacing.sm }}>
              <AppText variant="label">Active mixer loads</AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {data.active_loads!.map((load) => {
                  const active = (selected?.id || data.active_loads?.[0]?.id) === load.id;
                  return (
                    <Pressable key={load.id} onPress={() => setSelectedId(load.id)} style={[styles.loadChip, { backgroundColor: active ? colors.brand : colors.surfaceSecondary, borderColor: active ? colors.brand : colors.border }]}>
                      <Ionicons name="bus-outline" size={16} color={active ? colors.onBrand : colors.onSurfaceSecondary} />
                      <View>
                        <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: active ? colors.onBrand : colors.onSurface }}>{load.load_code || `Load ${load.load_number}`}</AppText>
                        <AppText style={{ fontFamily: fonts.regular, fontSize: 10, color: active ? colors.onBrand : colors.onSurfaceTertiary }}>{load.tm_number || "Mixer"} · {load.quantity_m3 || 0} m³</AppText>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <LiveMap
            destination={data.destination.lat != null ? { lat: data.destination.lat, lng: data.destination.lng! } : null}
            mixer={mapLocation ? { lat: mapLocation.lat, lng: mapLocation.lng } : null}
            polyline={route?.polyline}
            ended={data.status === "DELIVERED"}
            style={{ minHeight: 240 }}
          />

          {data.active && route ? (
            <View style={styles.etaRow}>
              <View style={[styles.etaCard, { backgroundColor: colors.brand }]}>
                <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onBrand }}>{route.eta_text}</AppText>
                <AppText style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.onBrand }}>Live ETA</AppText>
              </View>
              <View style={[styles.etaCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 }]}>
                <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onSurface }}>{route.distance_text}</AppText>
                <AppText style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.onSurfaceTertiary }}>Distance to site</AppText>
              </View>
            </View>
          ) : null}

          <Card style={{ gap: spacing.md }}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">{selected?.load_code || (data.status === "DELIVERED" ? "Delivery complete" : data.active ? "Mixer delivery" : "Not dispatched yet")}</AppText>
                {selected?.quantity_m3 ? <AppText variant="caption">{selected.quantity_m3} m³ delivery load</AppText> : null}
              </View>
              <Badge label={liveStatus.replace(/_/g, " ")} status={liveStatus} />
            </View>
            <Row icon="business-outline" label="Destination" value={`${data.destination.site_name}${data.destination.address ? " — " + data.destination.address : ""}`} colors={colors} />
            {tm ? <Row icon="bus-outline" label="Transit Mixer" value={tm} colors={colors} /> : null}
            {driver ? <Row icon="person-outline" label="Driver" value={driver} colors={colors} /> : null}
            {mapLocation ? <Row icon="navigate-outline" label="Mixer location" value={`${mapLocation.lat.toFixed(5)}, ${mapLocation.lng.toFixed(5)}`} colors={colors} /> : null}
            <Row icon="pulse-outline" label="Last GPS update" value={mapLocation?.at ? new Date(mapLocation.at).toLocaleTimeString() : "Awaiting driver location"} colors={colors} />
          </Card>

          {!mapLocation && data.active ? (
            <View style={[styles.note, { backgroundColor: colors.brandSoft }]}>
              <Ionicons name="information-circle-outline" size={16} color={colors.onBrandSoft} />
              <AppText style={{ flex: 1, fontFamily: fonts.medium, fontSize: fontSize.sm, color: colors.onBrandSoft }}>
                GPS for this mixer will appear after its driver starts the trip. Select another active load above to view its location.
              </AppText>
            </View>
          ) : null}

          {data.loads?.length ? (
            <View style={{ gap: spacing.sm }}>
              <AppText variant="heading">All Loads</AppText>
              {data.loads.map((load) => (
                <Card key={load.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Ionicons name="bus-outline" size={18} color={colors.brand} />
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{load.load_code || `Load ${load.load_number}`} · {load.quantity_m3 || 0} m³</AppText>
                    <AppText variant="caption">{[load.tm_number, load.driver_name].filter(Boolean).join(" · ") || "Not assigned"}</AppText>
                  </View>
                  <Badge label={(load.status || "").replace(/_/g, " ")} status={load.status} />
                </Card>
              ))}
            </View>
          ) : null}

          {data.active && driverMobile ? (
            <Button testID="track-call-driver" label="Call Selected Driver" onPress={() => Linking.openURL(`tel:${driverMobile}`)} icon={<Ionicons name="call-outline" size={18} color={colors.onBrand} />} />
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Row({ icon, label, value, colors }: any) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={16} color={colors.brand} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>{label}</AppText>
        <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{value}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  etaRow: { flexDirection: "row", gap: spacing.md },
  etaCard: { flex: 1, borderRadius: radius.lg, padding: spacing.md, gap: 2, alignItems: "flex-start" },
  note: { flexDirection: "row", gap: spacing.sm, alignItems: "center", padding: spacing.md, borderRadius: radius.md },
  loadChip: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 150, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
});
