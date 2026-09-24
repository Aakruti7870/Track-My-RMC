import React, { useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import {
  hasBackgroundLocationPermission,
  shouldTrackTrip,
  startTripLocationTracking,
  stopTripLocationTracking,
} from "@/src/location/tripTracking";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Trip = {
  id: string;
  order_number: string;
  status: string;
  grade: string;
  quantity: number;
  tm_number: string;
  site_name: string;
  site_address?: string;
};
type Detail = {
  trip: Trip;
  site_address?: string;
  pod?: { receiver_name: string; delivered_quantity: number } | null;
};

const ACTIONS: Record<
  string,
  { path: string; label: string; icon: keyof typeof Ionicons.glyphMap } | undefined
> = {
  DISPATCHED: { path: "start", label: "Start Trip", icon: "play-outline" },
  ASSIGNED: { path: "start", label: "Start Trip", icon: "play-outline" },
  ACCEPTED: { path: "start", label: "Start Trip", icon: "play-outline" },
  LOADING: { path: "start", label: "Start Trip", icon: "play-outline" },
  EN_ROUTE: { path: "arrive", label: "Reached Site", icon: "flag-outline" },
  ARRIVED: { path: "unload", label: "Start Unloading", icon: "download-outline" },
};

const STAGES = ["DISPATCHED", "EN_ROUTE", "ARRIVED", "UNLOADING", "DELIVERED"];
const TERMINAL = new Set(["DELIVERED", "DECLINED", "CANCELLED"]);

export default function TripDetail() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useGet<Detail>(`/driver/trips/${id}`);
  const [busy, setBusy] = useState(false);
  const [locationDisclosureVisible, setLocationDisclosureVisible] = useState(false);
  const foregroundWatch = useRef<{ remove: () => void } | null>(null);

  const t = data?.trip;
  const action = t ? ACTIONS[t.status] : undefined;
  const stageIdx = t
    ? STAGES.indexOf(t.status === "POD_PENDING" ? "UNLOADING" : t.status)
    : -1;

  const beginTracking = async (allowBackground: boolean) => {
    if (!id) return;
    const result = await startTripLocationTracking(id, { allowBackground });
    if (result.mode === "foreground") {
      foregroundWatch.current?.remove();
      foregroundWatch.current = result.subscription;
      if (allowBackground) {
        toast("Background location was not granted. Tracking will work only while TrackMyRMC is open.", "info");
      }
    } else if (result.mode === "denied") {
      toast("Location permission is required for live mixer tracking", "error");
    } else if (result.mode === "unavailable") {
      toast("Location services are unavailable. Turn on GPS for live tracking.", "error");
    }
  };

  useEffect(() => {
    let cancelled = false;
    foregroundWatch.current?.remove();
    foregroundWatch.current = null;

    if (!id || !t?.status) return;

    if (TERMINAL.has(t.status)) {
      setLocationDisclosureVisible(false);
      void stopTripLocationTracking();
      return;
    }

    if (shouldTrackTrip(t.status)) {
      void hasBackgroundLocationPermission().then((alreadyGranted) => {
        if (cancelled) return;
        if (alreadyGranted) {
          void beginTracking(true);
        } else {
          // Google Play requires this app-owned prominent disclosure to appear
          // before Android's location runtime permission prompt.
          setLocationDisclosureVisible(true);
        }
      });
    }

    return () => {
      cancelled = true;
      foregroundWatch.current?.remove();
      foregroundWatch.current = null;
    };
  }, [id, t?.status]);

  const acceptLocationDisclosure = async () => {
    setLocationDisclosureVisible(false);
    await beginTracking(true);
  };

  const declineLocationDisclosure = () => {
    setLocationDisclosureVisible(false);
    toast("Live mixer location sharing remains off. You can continue the trip and enable it later.", "info");
  };

  const advance = async (path: string, msg: string) => {
    setBusy(true);
    try {
      await apiPost(`/driver/trips/${id}/${path}`, token!);
      toast(msg, "success");
      reload();
    } catch (e: any) {
      toast(e.detail || "Failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const openNavigation = async () => {
    const destination = (data?.site_address || t?.site_address || t?.site_name || "").trim();
    if (!destination) {
      toast("Delivery address is unavailable", "error");
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error("unsupported");
      await Linking.openURL(url);
    } catch {
      toast("Unable to open navigation on this device", "error");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable
          testID="trip-back"
          onPress={() => router.back()}
          style={[styles.iconBtn, { borderColor: colors.border }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">{t?.order_number || "Trip"}</AppText>
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : loading && !data ? (
        <View style={{ padding: spacing.lg }}>
          <Skeleton height={300} style={{ borderRadius: radius.lg }} />
        </View>
      ) : t ? (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <Card style={{ gap: spacing.md }}>
            <View style={styles.rowBetween}>
              <AppText variant="caption">Status</AppText>
              <Badge label={t.status.replace(/_/g, " ")} status={t.status} />
            </View>
            <View style={styles.stages}>
              {STAGES.map((s, i) => (
                <React.Fragment key={s}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: i <= stageIdx ? colors.brand : colors.surfaceTertiary },
                    ]}
                  />
                  {i < STAGES.length - 1 ? (
                    <View
                      style={[
                        styles.bar,
                        { backgroundColor: i < stageIdx ? colors.brand : colors.surfaceTertiary },
                      ]}
                    />
                  ) : null}
                </React.Fragment>
              ))}
            </View>
            <View style={styles.rowBetween}>
              <AppText variant="caption">Dispatched</AppText>
              <AppText variant="caption">Delivered</AppText>
            </View>
          </Card>

          <Card style={{ gap: spacing.sm }}>
            <Row icon="layers-outline" label="Grade" value={t.grade} colors={colors} />
            <Row icon="cube-outline" label="Quantity" value={`${t.quantity} m³`} colors={colors} />
            <Row icon="bus-outline" label="Transit Mixer" value={t.tm_number} colors={colors} />
            <Row
              icon="location-outline"
              label="Site"
              value={`${t.site_name}${data?.site_address ? " — " + data.site_address : ""}`}
              colors={colors}
            />
          </Card>

          {t.status === "DELIVERED" ? (
            <Card
              style={{
                flexDirection: "row",
                gap: spacing.sm,
                alignItems: "center",
                backgroundColor: colors.success + "1A",
                borderColor: colors.success + "55",
              }}
            >
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <AppText style={{ flex: 1, fontFamily: fonts.medium, color: colors.onSurface }}>
                Delivered
                {data?.pod
                  ? ` · received by ${data.pod.receiver_name} (${data.pod.delivered_quantity} m³)`
                  : ""}
              </AppText>
            </Card>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Button
                testID="trip-navigate"
                label="Open Navigation"
                variant="secondary"
                onPress={openNavigation}
                icon={<Ionicons name="navigate-outline" size={18} color={colors.onSurface} />}
              />
              {action ? (
                <Button
                  testID="trip-advance"
                  label={action.label}
                  loading={busy}
                  onPress={() => advance(action.path, `${action.label} done`)}
                  icon={<Ionicons name={action.icon} size={18} color={colors.onBrand} />}
                />
              ) : t.status === "UNLOADING" || t.status === "POD_PENDING" ? (
                <Button
                  testID="trip-pod"
                  label="Complete Delivery (POD)"
                  onPress={() => router.push(`/pod/${id}` as any)}
                  icon={<Ionicons name="clipboard-outline" size={18} color={colors.onBrand} />}
                />
              ) : null}
            </View>
          )}
        </ScrollView>
      ) : null}

      <Modal
        visible={locationDisclosureVisible}
        transparent
        animationType="fade"
        onRequestClose={declineLocationDisclosure}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.disclosureCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.disclosureIcon, { backgroundColor: colors.brandSoft }]}>
              <Ionicons name="location-outline" size={26} color={colors.onBrandSoft} />
            </View>
            <AppText variant="title">Location for active deliveries</AppText>
            <AppText variant="bodyMuted">
              This app collects location data to enable live mixer delivery tracking even when the app is closed or not in use.
            </AppText>
            <AppText variant="bodyMuted">
              During an active assigned delivery, your location is sent to TrackMyRMC and shared with the assigned plant and the authorized customer tracking view. Tracking stops when the delivery is completed.
            </AppText>
            <AppText variant="caption">
              Location is not used for advertising. You can decline and continue using the trip workflow without background location sharing.
            </AppText>
            <Button label="Agree & Continue" onPress={acceptLocationDisclosure} />
            <Button label="Not now" variant="outline" onPress={declineLocationDisclosure} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ icon, label, value, colors }: any) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={16} color={colors.brand} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>
          {label}
        </AppText>
        <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stages: { flexDirection: "row", alignItems: "center" },
  dot: { width: 16, height: 16, borderRadius: 8 },
  bar: { flex: 1, height: 3, marginHorizontal: 2 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  disclosureCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.md,
  },
  disclosureIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
});