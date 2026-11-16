import { screenOverflow } from "@/src/theme/sceneBackground";
import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { HomeModuleSection, HomeSectionHeader } from "@/src/components/HomeModuleSection";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { OperationalHomeTopBar } from "@/src/components/OperationalHomeTopBar";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { DriverIdentityCard } from "@/src/components/DriverIdentityCard";
import { PlantHomeActions, PlantHomeHero } from "@/src/components/PlantHomeCards";
import { fonts, fontSize, radius, spacing, operationalStatus } from "@/src/theme/tokens";
import { IconTile } from "@/src/components/IconTile";

type Trip = { id: string; order_number: string; status: string; grade: string; quantity: number; tm_number: string; site_name: string };
type Home = { name: string; vehicle: string | null; active_trip: Trip | null; completed_today: number; checked_in: boolean };
type Attendance = { date: string; check_in: string | null; check_out: string | null };

const PLAY_REVIEW_DRIVER_NAME = "Google Play Review Driver";
const PLAY_REVIEW_ORDER_NUMBER = "PLAY-REVIEW-001";

export default function DriverHome() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
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
  const driverModules = modulesForRole(user?.role);
  const shortcutKeys = ["driver-trips", "driver-attendance", "shift-roster", "my-payslip"];
  const quickModules = shortcutKeys.flatMap(key => driverModules.filter(module => module.key === key));
  const driverTools = driverModules.filter(module => module.key === "workforce");
  const plantCards = <View style={styles.plantCards}>
    <PlantHomeHero label="Driver" testID="driver-home-plant-banner" />
    <HomeModuleSection id="driver-quick-access" title="Quick Access" modules={quickModules} homeShortcut testIDPrefix="driver-shortcut-" />
    <PlantHomeActions />
  </View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, overflow: screenOverflow }}>
      <OperationalHomeTopBar />
      {error && !data ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <DriverIdentityCard />
          {plantCards}
          <ErrorView message={error} onRetry={reload} />
        </ScrollView>
      ) : (
        <ScrollView
          testID="driver-home-scroll"
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void refetch(); void refetchAttendance(); }} tintColor={colors.brand} />}
        >
          <DriverIdentityCard />
          {plantCards}
          {(loading && !data) || (attendanceLoading && !attendance) ? (
            <>
              <Skeleton height={70} style={{ borderRadius: radius.md }} />
              <Skeleton height={180} style={{ borderRadius: radius.lg }} />
            </>
          ) : data ? (
            <>
              <AppText variant="heading">Smart Features</AppText>
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
                  accessibilityRole="button"
                  accessibilityLabel={data.active_trip ? "Open active trip" : "Open attendance"}
                  onPress={() => data.active_trip ? router.push(`/trip/${data.active_trip.id}` as any) : router.push("/driver/shift-attendance")}
                  style={styles.summaryAction}
                >
                  <IconTile icon={data.active_trip ? "navigate" : shiftComplete ? "checkmark-done" : "finger-print"} width={48} size={20} />
                </Pressable>
              </Card>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Pressable accessibilityRole="button" onPress={() => router.push("/driver/shift-attendance")} style={[styles.stat, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <IconTile symbol="driver-attendance" width={38} />
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.onSurface }}>{attendanceLabel}</AppText>
                </Pressable>
                <View style={[styles.stat, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: data.completed_today > 0 ? operationalStatus("success", colors.isDark) : colors.onSurface }}>{data.completed_today}</AppText>
                  <AppText variant="caption">Delivered today</AppText>
                </View>
                <View style={[styles.stat, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <IconTile symbol="transit-mixer-fleet" width={38} />
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.onSurface }}>{data.vehicle || "—"}</AppText>
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


              <HomeSectionHeader title="Current Trip" seeAll="/driver/trips" testID="home-see-all-driver-trips" />
              {data.active_trip ? (
                <Pressable testID="active-trip-card" onPress={() => router.push(`/trip/${data.active_trip!.id}` as any)}>
                  <Card style={{ gap: spacing.md }}>
                    <View style={styles.rowBetween}>
                      <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.onSurface }}>{data.active_trip.order_number}</AppText>
                      <Badge label={data.active_trip.status.replace(/_/g, " ")} status={data.active_trip.status} orderStatus />
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
              <HomeModuleSection id="driver-workforce" title="Workforce" modules={driverTools}
                seeAll={{ pathname: "/role-modules", params: { category: "Workforce" } }} />
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plantCards: { width: "100%", maxWidth: 620, alignSelf: "center", gap: 10 },
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
