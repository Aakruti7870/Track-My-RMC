import { getThemedCanvasColor, screenOverflow } from "@/src/theme/sceneBackground";
import React, { useState } from "react";
import { Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type VectorSymbolName } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { HomeModuleSection, HomeSectionHeader } from "@/src/components/HomeModuleSection";
import { HomeScroll } from "@/src/components/HomeScroll";
import { OperationalHomeTopBar } from "@/src/components/OperationalHomeTopBar";
import { PlantHomeActions, PlantHomeHero } from "@/src/components/PlantHomeCards";

import { useAuth } from "@/src/auth/AuthContext";
import { apiPost } from "@/src/api/client";
import { workforceLocationEvidence } from "@/src/location/workforceEvidence";
import { useToast } from "@/src/components/ui/Toast";
import { Button } from "@/src/components/ui/Button";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { StaffCollection } from "@/src/screens/StaffCollection";
import { STAFF_MODULE_GROUPS, staffModulesForScope, visibleStaffModules, type StaffModuleGrant } from "@/src/screens/StaffModuleDirectory";
import { fonts, fontSize, radius, spacing, operationalStatus, type OperationalStatus } from "@/src/theme/tokens";

type Kpi = { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; unit?: string | null };
type HomeData = {
  role: string;
  role_label: string;
  name: string;
  plant_name?: string;
  kpis: Kpi[];
  primary: { title: string; kind: string };
};
const ROLE_WORKSPACE: Record<string, { help: string; href: Href; key: string }> = {
  admin: { help: "Orders and fleet for your assigned plant", href: "/admin/orders", key: "dispatch_queue" },
  dispatcher: { help: "Allocate loads, mixers and delivery schedules", href: "/dispatcher/dispatch", key: "dispatch_queue" },
  operator: { help: "Production queue and approved material recipes", href: "/operator/production", key: "production_queue" },
  supervisor: { help: "Follow incidents and operational exceptions", href: "/supervisor/incidents", key: "incidents" },
  accountant: { help: "Plant invoices and collections", href: "/accountant/billing", key: "billing_ledger" },
  quality_engineer: { help: "Concrete quality records and mix documentation", href: "/quality_engineer/quality", key: "quality_register" },
  fleet_manager: { help: "Mixer availability and driver assignments", href: "/fleet_manager/fleet", key: "fleet_availability" },
  store_manager: { help: "Raw material balance and low-stock monitoring", href: "/store_manager/stock", key: "material_inventory" },
};
const KPI_ARTWORK: Record<string, VectorSymbolName> = {
  "Pending Orders": "plant-orders", "In Transit TMs": "transit-mixer-fleet", "Available TMs": "fleet-availability",
  "Staff Present Today": "attendance", "Materials": "material-inventory", "Low Stock": "low-stock-alert",
  "Items OK": "stock-register", "Billed": "billing", "Received": "ledger",
  "Outstanding": "expenses", "Invoices": "billing-history", "Total TMs": "transit-mixer-fleet",
  "Available": "fleet-availability", "On Trip": "assigned-trips", "Drivers": "drivers",
  "Open Incidents": "incident-register",
};
/** A zero alert is neutral; a positive exception is actionable. */
function kpiTone(k: Kpi): OperationalStatus {
  if (k.value <= 0) return "neutral";
  if (["Open Incidents"].includes(k.label)) return "critical";
  if (["Low Stock", "Pending Orders", "Outstanding"].includes(k.label)) return "warning";
  if (["Items OK", "Staff Present Today", "Received", "Available", "Available TMs"].includes(k.label))
    return "success";
  return "neutral";
}
function formatValue(k: Kpi): string {
  const value = Number(k.value);
  if (!Number.isFinite(value)) return "—";
  if (k.unit === "₹") return "₹" + Math.round(value).toLocaleString("en-IN");
  return value.toLocaleString("en-IN");
}

export function StaffHome() {
  const { colors } = useTheme();
  const { user, token } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const contentWidth = Math.max(0, Math.min(viewportWidth, 980) - 2 * spacing.lg);
  const kpiColumns = contentWidth >= 680 ? 4 : contentWidth >= 460 ? 3 : 2;
  const kpiWidth = (contentWidth - (kpiColumns - 1) * 10) / kpiColumns;
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/staff/home");
  const { data: workday, error: workdayError, refetch: refreshWorkday } =
    useGet<{ attendance: { check_in: string | null; check_out: string | null } | null }>("/workforce/me");
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const attendance = workday?.attendance;
  const checkedIn = !!attendance?.check_in && !attendance?.check_out;
  const shiftComplete = !!attendance?.check_out;
  const attendanceAction = async (path: "punch-in" | "punch-out") => {
    if (!token || attendanceBusy) return;
    setAttendanceBusy(true);
    try {
      const evidence = await workforceLocationEvidence("attendance");
      await apiPost(`/workforce/attendance/${path}`, token, evidence);
      toast(path === "punch-in" ? "Checked in for today" : "Checked out for today", "success");
      refreshWorkday();
      refetch();
    } catch (e: any) {
      toast(e?.detail || "Attendance update failed. Retry from My Workday.", "error");
    } finally {
      setAttendanceBusy(false);
    }
  };
  const { data: grants, loading: grantsLoading, error: grantsError, refetch: refreshGrants } =
    useGet<{ permissions: StaffModuleGrant[] }>("/staff/module-permissions");
  useFocusEffect(React.useCallback(() => {
    void refreshWorkday();
    void refreshGrants();
  }, [refreshWorkday, refreshGrants]));
  const workspace = ROLE_WORKSPACE[user?.role || ""] || ROLE_WORKSPACE.admin;
  const primaryAllowed = grants?.permissions.some(g => g.key === workspace.key && g.view) === true;
  const refresh = () => { refetch(); refreshGrants(); refreshWorkday(); };
  const modules = visibleStaffModules(staffModulesForScope(user?.role, "home"), grants?.permissions);
  const quickModules = modules.slice(0, 4);
  const roleTools = STAFF_MODULE_GROUPS.map(category => {
    const entries = modules.filter(module => module.group === category);
    const remaining = entries.filter(module => !quickModules.includes(module));
    return <HomeModuleSection key={category} id={category.toLowerCase()} title={category} modules={remaining.slice(0, 4)}
      seeAll={entries.length > 2 ? { pathname: "/role-modules", params: { category } } : undefined} />;
  });
  const shortcuts = (
    <View style={styles.topCards}>
      <HomeModuleSection id="quick-access" title="Quick Access" modules={quickModules} homeShortcut />
      {data ? (
        <Pressable
          testID="staff-home-summary" accessibilityRole="button" accessibilityLabel={"Open " + data.primary.title}
          accessibilityState={{ disabled: !primaryAllowed }} disabled={!primaryAllowed}
          onPress={() => router.push(workspace.href)}
          style={({ pressed }) => [styles.summary, {
            backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, opacity: pressed ? 0.82 : 1,
          }]}>
          <IconTile symbol="plant-dashboard" homeShortcut />
          <View style={styles.summaryCopy}>
            <AppText style={styles.summaryTitle}>{data.primary.title}</AppText>
            <AppText variant="caption">{workspace.help}</AppText>
            {!primaryAllowed ? <AppText variant="caption" color={colors.warning}>
              {grantsLoading ? "Checking access…" : grantsError ? "Unable to verify permissions" : "Access restricted by Plant Owner"}
            </AppText> : null}
          </View>
          <Ionicons name={primaryAllowed ? "chevron-forward" : "lock-closed-outline"} size={20} color={colors.accentText}
            accessible={false} aria-hidden />
        </Pressable>
      ) : null}
      <PlantHomeActions action="supplier-enquiry" homeShortcut />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "transparent", overflow: screenOverflow }}>
      <OperationalHomeTopBar />

      <HomeScroll testID="staff-home-scroll"
        gap={spacing.md} paddingHorizontal={spacing.lg} paddingTop={spacing.lg}
        backgroundColor={getThemedCanvasColor(colors)} tabBarOverlay={fontScale >= 1.3 ? 0 : 110}
        contentContainerStyle={{ paddingBottom: 130, width: "100%", maxWidth: 980, alignSelf: "center" }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refresh} tintColor={colors.brand} />}
        lead={<View style={styles.topCards}>
          <PlantHomeHero label={data?.role_label || user?.role_label || "Plant Staff"} testID="staff-home-hero-banner" />
        </View>}
        shortcuts={shortcuts}>
        <PlantHomeActions action="profile" homeShortcut />
        {error && !data ? (
          <>
            <ErrorView message={error} onRetry={reload} />
            {roleTools}
          </>
        ) : loading && !data ? (
          <>
            <Skeleton height={120} style={{ borderRadius: radius.lg }} />
            <Skeleton height={200} style={{ borderRadius: radius.lg }} />
          </>
        ) : data ? (
          <>
            <View style={styles.grid}>
              {data.kpis.map((c) => (
                <View key={c.label} style={[styles.kpi, { width: kpiWidth,
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: kpiTone(c) === "neutral"
                    ? colors.divider
                    : operationalStatus(kpiTone(c), colors.isDark) + "60",
                }]}>
                  <View style={styles.kpiIcon}>
                    {KPI_ARTWORK[c.label] ? <IconTile symbol={KPI_ARTWORK[c.label]} width={38} /> :
                      <IconTile icon={c.icon} width={38} />}
                    {c.label === "Low Stock" && c.value > 0 ? <Ionicons name="alert-circle" size={16} color={operationalStatus("warning", colors.isDark)} /> : null}
                  </View>
                  <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl,
                    color: kpiTone(c) === "neutral" ? colors.onSurface : operationalStatus(kpiTone(c), colors.isDark) }}>
                    {formatValue(c)}
                    {c.unit && c.unit !== "₹" ? <AppText style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.onSurfaceTertiary }}> {c.unit}</AppText> : null}
                  </AppText>
                  <AppText variant="caption">{c.label}</AppText>
                </View>
              ))}
            </View>

            <View testID="staff-workday-card" style={[styles.workday, {
              backgroundColor: colors.surfaceSecondary, borderColor: colors.border,
            }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="heading">My Workday</AppText>
                <AppText variant="caption">{shiftComplete ? "Shift complete" : checkedIn ? "On duty · checked in" : "Check in daily after signing in. Permission approval alone does not record attendance."}</AppText>
                {workdayError ? <AppText variant="caption" color={colors.error}>Attendance status unavailable. Retry from Workforce.</AppText> : null}
              </View>
              {!workdayError && workday && !checkedIn && !shiftComplete ?
                <Button testID="staff-home-check-in" label="Check In" size="sm"
                  loading={attendanceBusy} onPress={() => { void attendanceAction("punch-in"); }} /> : null}
              {!workdayError && workday && checkedIn ?
                <Button testID="staff-home-check-out" label="Check Out" size="sm" variant="outline"
                  loading={attendanceBusy} onPress={() => { void attendanceAction("punch-out"); }} /> : null}
            </View>
            {roleTools}
            <View style={{ gap: spacing.sm }}>
              <HomeSectionHeader title={data.primary.title} seeAll={primaryAllowed ? workspace.href : undefined}
                testID="home-see-all-staff-queue" />
              {primaryAllowed ? <StaffCollection kind={data.primary.kind} embedded limit={5} /> : (
                <View style={[styles.restricted, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <Ionicons name="shield-checkmark-outline" size={22} color={colors.brand} />
                  <AppText variant="bodyMuted" style={{ flex: 1 }}>
                    {grantsLoading ? "Checking your access…" : grantsError ?
                      "Permissions unavailable. Pull down to retry." : "This queue is not enabled for your staff account."}
                  </AppText>
                </View>
              )}
            </View>
          </>
        ) : null}
      </HomeScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.sm },
  iconBtn: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  badge: { position: "absolute", top: 8, right: 8, width: 9, height: 9, borderRadius: 5 },
  topCards: { width: "100%", maxWidth: 620, alignSelf: "center", gap: 10 },
  summary: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 9 },
  summaryCopy: { flex: 1, minWidth: 0, gap: 2 },
  summaryTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpi: { minHeight: 108, padding: 9, borderRadius: 16, borderWidth: 1, gap: 4 },
  kpiIcon: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  workday: { minHeight: 75, borderRadius: 16, borderWidth: 1, padding: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  restricted: { minHeight: 86, flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: radius.lg, borderWidth: 1, padding: 15 },
});
