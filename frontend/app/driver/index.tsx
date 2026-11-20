import { screenOverflow } from "@/src/theme/sceneBackground";
import React from "react";
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { HomeModuleSection, HomeSectionHeader } from "@/src/components/HomeModuleSection";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { OperationalHomeTopBar } from "@/src/components/OperationalHomeTopBar";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { HomeCardRow } from "@/src/components/HomeCardRow";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { DriverIdentityCard } from "@/src/components/DriverIdentityCard";
import { HomeAttendanceCard } from "@/src/components/HomeAttendanceCard";
import { useHomeAttendance } from "@/src/hooks/useHomeAttendance";
import { PlantHomeActions } from "@/src/components/PlantHomeCards";
import { fonts, fontSize, radius, spacing, operationalStatus } from "@/src/theme/tokens";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";

type Trip = { id: string; order_number: string; status: string; grade: string; quantity: number; tm_number: string; site_name: string };
type Home = { name: string; vehicle: string | null; active_trip: Trip | null; completed_today: number; checked_in: boolean };

const CONTENT_MAX_WIDTH = 1120;
const PLAY_REVIEW_DRIVER_NAME = "Google Play Review Driver";
const PLAY_REVIEW_ORDER_NUMBER = "PLAY-REVIEW-001";

export default function DriverHome() {
  const { colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const gutter = Math.max(width >= 768 ? 24 : 12, insets.left, insets.right);
  const bottomSpace = fontScale >= 1.3 ? spacing.lg : 96 + (Platform.OS === "web" ? 0 : insets.bottom);
  const statStyle = [styles.stat, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }];
  const { user } = useAuth();
  const router = useRouter();
  const { data, loading, error, refetch, reload } = useGet<Home>("/driver/home");
  const attendance = useHomeAttendance("driver", refetch);
  const isPlayReviewDriver = user?.name === PLAY_REVIEW_DRIVER_NAME;

  const shiftComplete = attendance.complete;
  const checkedIn = attendance.error ? data?.checked_in : attendance.checkedIn;
  const summaryTitle = data?.active_trip
    ? "Delivery underway"
    : shiftComplete
      ? "Shift complete"
      : checkedIn
        ? "Ready for assignment"
        : "Start your shift";
  const attendanceLabel = checkedIn ? "On Duty" : shiftComplete ? "Shift Done" : "Attendance record";
  const homeUnavailable = error && !data;
  const homeLoading = loading && !data;
  const driverModules = modulesForRole(user?.role);
  const shortcutKeys = ["driver-trips", "driver-attendance", "shift-roster", "my-payslip"];
  const quickModules = shortcutKeys.flatMap(key => driverModules.filter(module => module.key === key));
  const driverTools = driverModules.filter(module => module.key === "workforce");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, overflow: screenOverflow }}>
      <View style={[styles.frame, { maxWidth: CONTENT_MAX_WIDTH + gutter * 2, paddingHorizontal: gutter - 12 }]}>
        <OperationalHomeTopBar />
      </View>
      <ScrollView
        testID="driver-home-scroll"
        contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: gutter, paddingBottom: bottomSpace }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void refetch(); void attendance.refetch(); }} tintColor={colors.brand} />}
      >
        <View style={[styles.frame, styles.content]}>
          <DriverIdentityCard />
          <HomeAttendanceCard attendance={attendance} />
          <HomeModuleSection id="driver-quick-access" title="Quick Access" modules={quickModules} homeShortcut testIDPrefix="driver-shortcut-" />
          <PlantHomeActions style={styles.plantActions} />
          {homeUnavailable ? <ErrorView message={error} onRetry={reload} /> : homeLoading ? (
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
                  <IconTile symbol={data.active_trip ? "assigned-trips" : shiftComplete ? "success" : "check-in"} width={48} size={20} />
                </Pressable>
              </Card>
              <HomeCardRow testID="driver-home-stats-row" label="Driver shift metrics" minCardWidth={94} gap={spacing.sm}>
                <Pressable accessibilityRole="button" onPress={() => router.push("/driver/shift-attendance")} style={statStyle}>
                  <IconTile symbol="driver-attendance" width={38} />
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.onSurface }} center>{attendanceLabel}</AppText>
                </Pressable>
                <View style={statStyle}>
                  <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: data.completed_today > 0 ? operationalStatus("success", colors.isDark) : colors.onSurface }}>{data.completed_today}</AppText>
                  <AppText variant="caption" center>Delivered today</AppText>
                </View>
                <View style={statStyle}>
                  <IconTile symbol="transit-mixer-fleet" width={38} />
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.onSurface }} center>{data.vehicle || "—"}</AppText>
                </View>
              </HomeCardRow>

              {isPlayReviewDriver ? (
                <Card testID="play-review-location-hint" style={{ gap: spacing.sm, backgroundColor: colors.brandSoft, borderColor: colors.brand + "44" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <VectorSymbol name="driver-license" size={20} color={colors.brand} />
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
                      <VectorSymbol name="gps-live-location" size={16} color={colors.brand} />
                      <AppText variant="body" style={{ flex: 1 }} numberOfLines={1}>{data.active_trip.site_name}</AppText>
                    </View>
                    <View style={[styles.openBtn, { backgroundColor: colors.brand }]}>
                      <AppText style={{ fontFamily: fonts.semibold, color: colors.onBrand }}>Open Trip</AppText>
                      <VectorSymbol name="arrow-right" size={16} color={colors.onBrand} />
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
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", alignSelf: "center" },
  content: { maxWidth: CONTENT_MAX_WIDTH, gap: spacing.md },
  plantActions: { maxWidth: "100%" },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 108 },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  summaryAction: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  stat: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 4, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  siteRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  openBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 44, borderRadius: radius.md },
});
