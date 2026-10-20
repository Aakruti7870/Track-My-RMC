import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { StaffCollection } from "@/src/screens/StaffCollection";
import { StaffModuleDirectory } from "@/src/screens/StaffModuleDirectory";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Kpi = { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; unit?: string | null };
type HomeData = {
  role: string;
  role_label: string;
  name: string;
  plant_name?: string;
  kpis: Kpi[];
  primary: { title: string; kind: string };
};
const ROLE_WORKSPACE: Record<string, { tagline: string; help: string; symbol: VectorSymbolName; href: string; key: string }> = {
  admin: { tagline: "Plant Operations", help: "Orders and fleet for your assigned plant", symbol: "plant-order-management", href: "/admin/orders", key: "dispatch_queue" },
  dispatcher: { tagline: "Dispatch Control", help: "Allocate loads, mixers and delivery schedules", symbol: "dispatch-queue", href: "/dispatcher/dispatch", key: "dispatch_queue" },
  operator: { tagline: "Batching Operations", help: "Production queue and approved material recipes", symbol: "batching-operations", href: "/operator/production", key: "production_queue" },
  supervisor: { tagline: "Plant Oversight", help: "Follow incidents and operational exceptions", symbol: "incident-register", href: "/supervisor/incidents", key: "incidents" },
  accountant: { tagline: "Commercial Workspace", help: "Plant invoices and collections", symbol: "billing", href: "/accountant/billing", key: "billing_ledger" },
  quality_engineer: { tagline: "Quality Assurance", help: "Concrete quality records and mix documentation", symbol: "quality-register", href: "/quality_engineer/quality", key: "quality_register" },
  fleet_manager: { tagline: "Transport Operations", help: "Mixer availability and driver assignments", symbol: "transit-mixer-fleet", href: "/fleet_manager/fleet", key: "fleet_availability" },
  store_manager: { tagline: "Inventory Control", help: "Raw material balance and low-stock monitoring", symbol: "stock-register", href: "/store_manager/stock", key: "material_inventory" },
};
const KPI_ARTWORK: Record<string, VectorSymbolName> = {
  "Pending Orders": "plant-orders", "In Transit TMs": "transit-mixer-fleet", "Available TMs": "fleet-availability",
  "Staff Present Today": "attendance", "Materials": "material-inventory", "Low Stock": "low-stock-alert",
  "Items OK": "stock-register", "Billed": "billing", "Received": "ledger",
  "Outstanding": "expenses", "Invoices": "billing-history", "Total TMs": "transit-mixer-fleet",
  "Available": "fleet-availability", "On Trip": "assigned-trips", "Drivers": "drivers",
  "Open Incidents": "incident-register",
};
function formatValue(k: Kpi): string {
  const value = Number(k.value);
  if (!Number.isFinite(value)) return "—";
  if (k.unit === "₹") return "₹" + Math.round(value).toLocaleString("en-IN");
  return value.toLocaleString("en-IN");
}

export function StaffHome() {
  const { colors, toggle, scheme } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/staff/home");
  const { data: notif } = useGet<{ unread: number }>("/notifications");
  const { data: grants, loading: grantsLoading, error: grantsError, refetch: refreshGrants } =
    useGet<{ permissions: Array<{ key: string; view: boolean }> }>("/staff/module-permissions");
  const workspace = ROLE_WORKSPACE[user?.role || ""] || ROLE_WORKSPACE.admin;
  const primaryAllowed = grants?.permissions.some(g => g.key === workspace.key && g.view) === true;
  const refresh = () => { refetch(); refreshGrants(); };

  return (
    <View style={{ flex: 1, backgroundColor: "transparent" }}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <AppText variant="eyebrow">{data?.role_label || user?.role_label}</AppText>
          <AppText variant="title" numberOfLines={1}>{data?.name || user?.name}</AppText>
          {data?.plant_name ? <AppText variant="caption" numberOfLines={1}>{data.plant_name}</AppText> : null}
        </View>
        <Pressable testID="staff-notif" accessibilityRole="button" accessibilityLabel="Open notifications" onPress={() => router.push("/notifications")} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="notifications-outline" size={20} color={colors.onSurface} />
          {notif && notif.unread > 0 ? <View style={[styles.badge, { backgroundColor: colors.brand }]} /> : null}
        </Pressable>
        <Pressable testID="staff-theme-toggle" accessibilityRole="button" accessibilityLabel="Switch light or dark theme" onPress={toggle} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name={scheme === "dark" ? "sunny-outline" : "moon-outline"} size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {error && !data ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}><ErrorView message={error} onRetry={reload} /><StaffModuleDirectory role={user?.role} /></ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 130, gap: spacing.xl, width: "100%", maxWidth: 980, alignSelf: "center" }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refresh} tintColor={colors.brand} />}
        >
          {loading && !data ? (
            <>
              <Skeleton height={120} style={{ borderRadius: radius.lg }} />
              <Skeleton height={200} style={{ borderRadius: radius.lg }} />
            </>
          ) : data ? (
            <>
              <Pressable
                testID="staff-home-summary" accessibilityRole="button" accessibilityLabel={"Open " + data.primary.title}
                accessibilityState={{ disabled: !primaryAllowed }} disabled={!primaryAllowed}
                onPress={() => router.push(workspace.href as any)}
                style={({ pressed }) => [styles.summary, {
                  backgroundColor: colors.isDark ? "rgba(30,35,42,0.88)" : "rgba(255,255,255,0.88)",
                  borderColor: colors.isDark ? "rgba(255,154,61,0.40)" : "rgba(255,255,255,0.98)",
                  opacity: pressed ? 0.82 : 1,
                }]}>
                <View style={{ flex: 1, gap: 6 }}>
                  <AppText variant="eyebrow">{workspace.tagline}</AppText>
                  <AppText style={[styles.summaryTitle, { color: colors.onSurface }]} numberOfLines={2}>{data.primary.title}</AppText>
                  <AppText style={{ color: colors.onSurfaceTertiary, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>{workspace.help}</AppText>
                  {!primaryAllowed ? <AppText style={{ fontSize: 11, color: colors.warning }}>
                    {grantsLoading ? "Checking access…" : grantsError ? "Unable to verify permissions" : "Access restricted by Plant Owner"}
                  </AppText> : null}
                </View>
                <View style={styles.heroArtwork}>
                  <VectorSymbol name={workspace.symbol} size={65} warmAccent />
                  <Ionicons name={primaryAllowed ? "arrow-forward-circle-outline" : "lock-closed-outline"} size={20} color={colors.brand} />
                </View>
              </Pressable>
              <View style={styles.grid}>
                {data.kpis.map((c) => (
                  <View key={c.label} style={[styles.kpi, {
                    backgroundColor: colors.isDark ? "rgba(29,35,43,0.88)" : "rgba(255,255,255,0.84)",
                    borderColor: colors.isDark ? "rgba(255,154,61,0.26)" : "rgba(255,255,255,0.97)",
                  }]}>
                    <View style={styles.kpiIcon}>
                      {KPI_ARTWORK[c.label] ? <VectorSymbol name={KPI_ARTWORK[c.label]} size={36} warmAccent /> :
                        <Ionicons name={c.icon} size={26} color={colors.brand} />}
                      {c.label === "Low Stock" && c.value > 0 ? <Ionicons name="alert-circle" size={16} color={colors.warning} /> : null}
                    </View>
                    <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onSurface }} numberOfLines={1}>
                      {formatValue(c)}
                      {c.unit && c.unit !== "₹" ? <AppText style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.onSurfaceTertiary }}> {c.unit}</AppText> : null}
                    </AppText>
                    <AppText variant="caption">{c.label}</AppText>
                  </View>
                ))}
              </View>

              <View style={{ gap: spacing.sm }}>
                <AppText variant="heading">{data.primary.title}</AppText>
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
              <StaffModuleDirectory role={user?.role} />
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.sm },
  iconBtn: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  badge: { position: "absolute", top: 8, right: 8, width: 9, height: 9, borderRadius: 5 },
  summary: { minHeight: 155, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 22,
    padding: 18, shadowColor: "#BC782C", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.1,
    shadowRadius: 15, elevation: 2 },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], lineHeight: 28 },
  heroArtwork: { width: 80, alignItems: "center", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpi: { width: "47%", flexGrow: 1, minHeight: 136, padding: 12, borderRadius: 18, borderWidth: 1, gap: 6,
    shadowColor: "#996847", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1 },
  kpiIcon: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  restricted: { minHeight: 86, flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: radius.lg, borderWidth: 1, padding: 15 },
});
