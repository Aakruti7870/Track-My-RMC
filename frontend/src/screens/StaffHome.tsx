import { screenOverflow } from "@/src/theme/sceneBackground";
import React from "react";
import { Platform, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type VectorSymbolName } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeModuleSection, HomeSectionHeader } from "@/src/components/HomeModuleSection";
import { CardHighlight } from "@/src/components/ui/CardHighlight";
import { HomeScroll } from "@/src/components/HomeScroll";
import { OperationalHomeTopBar } from "@/src/components/OperationalHomeTopBar";
import { PlantHomeActions, PlantHomeHero } from "@/src/components/PlantHomeCards";

import { useAuth } from "@/src/auth/AuthContext";
import { HomeAttendanceCard } from "@/src/components/HomeAttendanceCard";
import { useHomeAttendance } from "@/src/hooks/useHomeAttendance";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { StaffCollection } from "@/src/screens/StaffCollection";
import { STAFF_MODULE_GROUPS, staffModulesForScope, visibleStaffModules, type StaffModuleGrant } from "@/src/screens/StaffModuleDirectory";
import { LoadPipeline, WorkspaceTile, businessPath } from "@/src/owner/PlantOperations";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
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
const CONTENT_MAX_WIDTH = 980;

const ROLE_WORKSPACE: Record<string, { help: string; href: Href; key: string }> = {
  admin: { help: "Orders and fleet for your assigned plant", href: "/plant-admin/orders", key: "dispatch_queue" },
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
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const gutter = Math.max(spacing.lg, insets.left, insets.right);
  const contentWidth = Math.max(0, Math.min(viewportWidth, CONTENT_MAX_WIDTH) - 2 * gutter);
  const readableWidth = contentWidth / fontScale;
  const kpiColumns = readableWidth >= 680 ? 4 : readableWidth >= 460 ? 3 : readableWidth >= 240 ? 2 : 1;
  const kpiWidth = (contentWidth - (kpiColumns - 1) * 10) / kpiColumns;
  const bottomSpace = fontScale >= 1.3 ? spacing.lg : 96 + (Platform.OS === "web" ? 0 : insets.bottom);
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/staff/home");
  const attendance = useHomeAttendance("staff", refetch);
  const { data: grants, loading: grantsLoading, error: grantsError, refetch: refreshGrants } =
    useGet<{ plant_id?: string; permissions: StaffModuleGrant[] }>("/staff/module-permissions");
  const admin = user?.role === "admin";
  const adminPlant = admin && !grantsError ? grants?.plant_id : undefined;
  const { data: manager, refetch: refreshManager } = useGet<{ enabled: boolean; can_manage_staff?: boolean }>(admin ? "/staff/manager-access" : null);
  const canManageStaff = manager?.enabled === true && manager.can_manage_staff === true;
  useFocusEffect(React.useCallback(() => {
    void refreshGrants();
    void refreshManager();
  }, [refreshGrants, refreshManager]));
  const workspace = ROLE_WORKSPACE[user?.role || ""] || ROLE_WORKSPACE.admin;
  const primaryAllowed = grants?.permissions.some(g => g.key === workspace.key && g.view) === true;
  const refresh = () => { refetch(); refreshGrants(); void attendance.refetch(); refreshManager(); };
  const modules = visibleStaffModules(staffModulesForScope(user?.role, "home"), grants?.permissions);
  const adminKeys = ["admin-orders", "admin-fleet", "business-inventory", "business-staff"];
  const adminShortcuts = admin && !grantsError
    ? visibleStaffModules(adminKeys.flatMap(key => modulesForRole("admin").filter(module => module.key === key)),
        grants?.permissions, canManageStaff)
      .map(module => ({
        ...module,
        label: module.key === "admin-orders" ? "Plant Orders" : module.key === "admin-fleet" ? "Fleet"
          : module.key === "business-inventory" ? "Inventory" : module.label,
      }))
    : [];
  const quickModules = admin ? adminShortcuts : modules.slice(0, 4);
  const roleTools = STAFF_MODULE_GROUPS.map(category => {
    const entries = modules.filter(module => module.group === category);
    const remaining = entries.filter(module => !quickModules.some(quick => quick.key === module.key));
    return <HomeModuleSection key={category} id={category.toLowerCase()} title={category} modules={remaining.slice(0, 4)}
      seeAll={entries.length > 2 ? { pathname: "/role-modules", params: { category } } : undefined} />;
  });
  const shortcuts = (
    <View style={styles.topCards}>
      <HomeModuleSection id="quick-access" title="Quick Access" modules={quickModules} homeShortcut />
      {admin ? <WorkspaceTile title="Open Operations" symbol="production-and-dispatch" tone="warning" destination="/plant-admin/operations" /> : null}
      {adminPlant && primaryAllowed ? <LoadPipeline plantId={adminPlant} showAlert /> : null}
      {adminPlant && grants?.permissions.some(grant => grant.key === "purchases" && grant.view) ?
        <WorkspaceTile title="Material Purchases" symbol="material-receipts" destination={businessPath("purchases", adminPlant)} /> : null}
      {adminPlant && grants?.permissions.some(grant => grant.key === "diesel_ledger" && grant.view) ?
        <WorkspaceTile title="Diesel Ledger" symbol="diesel-ledger" destination={businessPath("diesel", adminPlant)} /> : null}
      {data && !admin ? (
        <Pressable
          testID="staff-home-summary" accessibilityRole="button" accessibilityLabel={"Open " + data.primary.title}
          accessibilityState={{ disabled: !primaryAllowed }} disabled={!primaryAllowed}
          onPress={() => router.push(workspace.href)}
          style={({ pressed }) => [styles.summary, {
            backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, opacity: pressed ? 0.82 : 1,
          }]}>
          <CardHighlight radius={10} />
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
      <PlantHomeActions action="supplier-enquiry" style={styles.stretchActions} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: admin ? colors.canvas : "transparent", overflow: screenOverflow }}>
      <View style={[styles.headerFrame, { paddingHorizontal: gutter - 12 }]}>
        <OperationalHomeTopBar />
      </View>

      <HomeScroll testID="staff-home-scroll"
        gap={spacing.md} paddingHorizontal={gutter} paddingTop={spacing.lg}
        contentContainerStyle={{ paddingBottom: bottomSpace, width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refresh} tintColor={colors.brand} />}
      >
        <View style={styles.topCards}>
          <PlantHomeHero label={admin ? "Plant Admin" : data?.role_label || user?.role_label || "Plant Staff"} testID="staff-home-hero-banner"
            profile={admin && adminPlant ? { pathname: "/plant-profile", params: { assigned: "1", plantId: adminPlant } } : undefined} />
        </View>
        <HomeAttendanceCard attendance={attendance} />
        {shortcuts}
        {!admin || !adminPlant ? <PlantHomeActions action="profile" style={styles.stretchActions} /> : null}
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
                  <CardHighlight radius={16} />
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
  headerFrame: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" },
  topCards: { width: "100%", gap: 10 },
  stretchActions: { maxWidth: "100%" },
  summary: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 9 },
  summaryCopy: { flex: 1, minWidth: 0, gap: 2 },
  summaryTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpi: { minHeight: 108, padding: 9, borderRadius: 16, borderWidth: 1, gap: 4 },
  kpiIcon: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  restricted: { minHeight: 86, flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: radius.lg, borderWidth: 1, padding: 15 },
});
