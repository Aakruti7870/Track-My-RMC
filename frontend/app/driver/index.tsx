import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Trip = { id: string; order_number: string; status: string; grade: string; quantity: number; tm_number: string; site_name: string };
type Home = { name: string; vehicle: string | null; active_trip: Trip | null; completed_today: number; checked_in: boolean };
type Attendance = { date: string; check_in: string | null; check_out: string | null };

const PLAY_REVIEW_DRIVER_NAME = "Google Play Review Driver";
const PLAY_REVIEW_ORDER_NUMBER = "PLAY-REVIEW-001";

export default function DriverHome() {
  const { colors, toggle, scheme } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<Home>("/driver/home");
  const { data: attendance, loading: attendanceLoading, refetch: refetchAttendance } = useGet<Attendance>("/driver/attendance");
  const isPlayReviewDriver = user?.name === PLAY_REVIEW_DRIVER_NAME;

  const shiftComplete = !!attendance?.check_out;
  const attendanceKnown = !!attendance;
  const summaryTitle = data?.active_trip
    ? "Delivery underway"
    : shiftComplete
      ? "Shift complete"
      : data?.checked_in
        ? "Ready for assignment"
        : attendanceKnown
          ? "Start your shift"
          : "Attendance";
  const attendanceLabel = data?.checked_in ? "On Duty" : shiftComplete ? "Shift Done" : attendanceKnown ? "Check In" : "Attendance";
  const attendanceIcon: keyof typeof Ionicons.glyphMap = data?.checked_in ? "checkmark-circle" : shiftComplete ? "checkmark-done" : "time-outline";
  const attendanceColor = data?.checked_in || shiftComplete ? colors.success : colors.warning;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <AppText variant="caption">Driver</AppText>
          <AppText variant="title" numberOfLines={1}>{user?.name}</AppText>
        </View>
        <Pressable testID="driver-sos" onPress={() => router.push("/sos")} style={[styles.iconBtn, { borderColor: colors.error, backgroundColor: colors.error + "1A" }]}>
          <Ionicons name="warning-outline" size={20} color={colors.error} />
        </Pressable>
        <Pressable testID="driver-theme-toggle" onPress={toggle} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name={scheme === "dark" ? "sunny-outline" : "moon-outline"} size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void refetch(); void refetchAttendance(); }} tintColor={colors.brand} />}
        >
          {(loading && !data) || (attendanceLoading && !attendance) ? (
            <>
              <Skeleton height={70} style={{ borderRadius: radius.md }} />
              <Skeleton height={180} style={{ borderRadius: radius.lg }} />
            </>
          ) : data ? (
            <>
              <Card variant="brand" style={styles.summary} testID="driver-home-summary">
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <AppText variant="caption">TODAY&apos;S SHIFT</AppText>
                  <AppText style={styles.summaryTitle}>{summaryTitle}</AppText>
                  <AppText variant="bodyMuted" numberOfLines={1}>
                    {data.active_trip
                      ? `${data.active_trip.order_number} · ${data.active_trip.site_name}`
                      : shiftComplete
                        ? "Today's attendance is complete"
                        : data.vehicle
                          ? `Assigned to ${data.vehicle}`
                          : "No vehicle assigned"}
                  </AppText>
                </View>
                <Pressable
                  accessibilityLabel={data.active_trip ? "Open active trip" : "Open attendance"}
                  onPress={() => data.active_trip ? router.push(`/trip/${data.active_trip.id}` as any) : router.push("/driver/attendance")}
                  style={[styles.summaryAction, { backgroundColor: colors.brand }]}
                >
                  <Ionicons name={data.active_trip ? "navigate" : shiftComplete ? "checkmark-done" : "finger-print"} size={20} color={colors.onBrand} />
                </Pressable>
              </Card>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Pressable onPress={() => router.push("/driver/attendance")} style={[styles.stat, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <Ionicons name={attendanceIcon} size={20} color={attendanceColor} />
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.onSurface }}>{attendanceLabel}</AppText>
                </Pressable>
                <View style={[styles.stat, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.brand }}>{data.completed_today}</AppText>
                  <AppText variant="caption">Delivered today</AppText>
                </View>
                <View style={[styles.stat, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <Ionicons name="bus" size={20} color={colors.onSurface} />
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.onSurface }} numberOfLines={1}>{data.vehicle || "—"}</AppText>
                </View>
              </View>

              {isPlayReviewDriver ? (
                <Card testID="play-review-location-hint" style={{ gap: spacing.sm, backgroundColor: colors.brandSoft, borderColor: colors.brand + "44" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Ionicons name="shield-checkmark-outline" size={20} color={colors.brand} />
                    <AppText variant="label">Google Play background-location review</AppText>
                  </View>
                  <AppText variant="bodyMuted">
                    Open Current Trip {PLAY_REVIEW_ORDER_NUMBER}. TrackMyRMC shows its prominent location disclosure before Android asks for location permission, then requests background access only for the active delivery.
                  </AppText>
                </Card>
              ) : null}

              <AppText variant="heading">Current Trip</AppText>
              {data.active_trip ? (
                <Pressable testID="active-trip-card" onPress={() => router.push(`/trip/${data.active_trip!.id}` as any)}>
                  <Card style={{ gap: spacing.md }}>
                    <View style={styles.rowBetween}>
                      <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.onSurface }}>{data.active_trip.order_number}</AppText>
                      <Badge label={data.active_trip.status.replace(/_/g, " ")} status={data.active_trip.status} />
                    </View>
                    <AppText variant="caption">{data.active_trip.grade} · {data.active_trip.quantity} m³ · {data.active_trip.tm_number}</AppText>
                    <View style={styles.siteRow}>
                      <Ionicons name="location-outline" size={16} color={colors.brand} />
                      <AppText variant="body" style={{ flex: 1 }} numberOfLines={1}>{data.active_trip.site_name}</AppText>
                    </View>
                    <View style={[styles.openBtn, { backgroundColor: colors.brand }]}>
                      <AppText style={{ fontFamily: fonts.semibold, color: colors.onBrand }}>Open Trip</AppText>
                      <Ionicons name="arrow-forward" size={16} color={colors.onBrand} />
                    </View>
                  </Card>
                </Pressable>
              ) : (
                <Card style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
                  <Ionicons name="cafe-outline" size={32} color={colors.onSurfaceTertiary} />
                  <AppText variant="bodyMuted">No active trip. Enjoy the break!</AppText>
                </Card>
              )}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.sm },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 108 },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  summaryAction: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  stat: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  siteRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  openBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 44, borderRadius: radius.md },
});
