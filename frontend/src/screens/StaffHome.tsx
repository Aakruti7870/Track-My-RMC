import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Href, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { StaffCollection } from "@/src/screens/StaffCollection";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Kpi = { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; unit?: string | null };
type HomeData = {
  role: string;
  role_label: string;
  name: string;
  kpis: Kpi[];
  primary: { title: string; kind: string };
};
type ModuleLink = { label: string; icon: keyof typeof Ionicons.glyphMap; route: Href };

const ROLE_MODULES: Record<string, ModuleLink[]> = {
  admin: [
    { label: "Rate Cards", icon: "pricetag-outline", route: "/business/rates" },
    { label: "Mix Designs", icon: "flask-outline", route: "/business/mixes" },
    { label: "Inventory", icon: "cube-outline", route: "/business/inventory" },
    { label: "Suppliers", icon: "people-circle-outline", route: "/business/suppliers" },
    { label: "Purchases", icon: "cart-outline", route: "/business/purchases" },
    { label: "Fleet", icon: "bus-outline", route: "/business/fleet" },
    { label: "Diesel", icon: "water-outline", route: "/business/diesel" },
    { label: "Quotations", icon: "document-text-outline", route: "/business/quotations" },
    { label: "Expenses", icon: "cash-outline", route: "/business/expenses" },
    { label: "Payroll", icon: "card-outline", route: "/business/payroll" },
    { label: "Attendance", icon: "calendar-outline", route: "/business/attendance" },
    { label: "Staff", icon: "people-outline", route: "/business/staff" },
    { label: "Customers", icon: "person-outline", route: "/business/customers" },
    { label: "Reports", icon: "bar-chart-outline", route: "/business/reports" },
  ],
  dispatcher: [
    { label: "Attendance", icon: "calendar-outline", route: "/business/attendance" },
    { label: "Plant Report", icon: "bar-chart-outline", route: "/business/reports" },
  ],
  operator: [
    { label: "Attendance", icon: "calendar-outline", route: "/business/attendance" },
    { label: "Plant Report", icon: "bar-chart-outline", route: "/business/reports" },
  ],
  supervisor: [
    { label: "Attendance", icon: "calendar-outline", route: "/business/attendance" },
    { label: "Plant Report", icon: "bar-chart-outline", route: "/business/reports" },
  ],
  accountant: [
    { label: "Rate Cards", icon: "pricetag-outline", route: "/business/rates" },
    { label: "Quotations", icon: "document-text-outline", route: "/business/quotations" },
    { label: "Expenses", icon: "cash-outline", route: "/business/expenses" },
    { label: "Payroll", icon: "card-outline", route: "/business/payroll" },
    { label: "Plant Report", icon: "bar-chart-outline", route: "/business/reports" },
  ],
  quality_engineer: [
    { label: "Mix Designs", icon: "flask-outline", route: "/business/mixes" },
    { label: "Attendance", icon: "calendar-outline", route: "/business/attendance" },
    { label: "Plant Report", icon: "bar-chart-outline", route: "/business/reports" },
  ],
  fleet_manager: [
    { label: "Fleet", icon: "bus-outline", route: "/business/fleet" },
    { label: "Diesel", icon: "water-outline", route: "/business/diesel" },
    { label: "Attendance", icon: "calendar-outline", route: "/business/attendance" },
  ],
  store_manager: [
    { label: "Inventory", icon: "cube-outline", route: "/business/inventory" },
    { label: "Suppliers", icon: "people-circle-outline", route: "/business/suppliers" },
    { label: "Purchases", icon: "cart-outline", route: "/business/purchases" },
    { label: "Diesel", icon: "water-outline", route: "/business/diesel" },
    { label: "Attendance", icon: "calendar-outline", route: "/business/attendance" },
  ],
};

function formatValue(k: Kpi): string {
  if (k.unit === "₹") return `₹${Number(k.value).toLocaleString("en-IN")}`;
  return `${k.value}`;
}

export function StaffHome() {
  const { colors, toggle, scheme } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/staff/home");
  const { data: notif } = useGet<{ unread: number }>("/notifications");
  const role = data?.role || user?.role || "";
  const modules = ROLE_MODULES[role] || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <AppText variant="caption">{data?.role_label || user?.role_label}</AppText>
          <AppText variant="title" numberOfLines={1}>{data?.name || user?.name}</AppText>
        </View>
        <Pressable testID="staff-notif" onPress={() => router.push("/notifications")} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="notifications-outline" size={20} color={colors.onSurface} />
          {notif && notif.unread > 0 ? <View style={[styles.badge, { backgroundColor: colors.brand }]} /> : null}
        </Pressable>
        <Pressable testID="staff-theme-toggle" onPress={toggle} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name={scheme === "dark" ? "sunny-outline" : "moon-outline"} size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}
        >
          {loading && !data ? (
            <>
              <Skeleton height={120} style={{ borderRadius: radius.lg }} />
              <Skeleton height={200} style={{ borderRadius: radius.lg }} />
            </>
          ) : data ? (
            <>
              <View style={[styles.summary, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "3D" }]} testID="staff-home-summary">
                <View style={[styles.summaryIcon, { backgroundColor: colors.brand }]}><Ionicons name="pulse" size={21} color={colors.onBrand} /></View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <AppText variant="caption">LIVE WORKSPACE</AppText>
                  <AppText style={styles.summaryTitle} numberOfLines={1}>{data.primary.title}</AppText>
                  <AppText variant="bodyMuted">Current operational queue from your plant</AppText>
                </View>
                <Ionicons name="chevron-down" size={20} color={colors.onBrandSoft} />
              </View>
              <View style={styles.grid}>
                {data.kpis.map((c) => (
                  <View key={c.label} style={[styles.kpi, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                    <View style={[styles.kpiIcon, { backgroundColor: colors.brandSoft }]}>
                      <Ionicons name={c.icon} size={18} color={colors.onBrandSoft} />
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
                <StaffCollection kind={data.primary.kind} embedded limit={6} />
              </View>

              {modules.length ? (
                <View style={{ gap: spacing.sm }}>
                  <AppText variant="heading">Operations</AppText>
                  <View style={styles.moduleGrid}>
                    {modules.map((m) => (
                      <Pressable key={m.label} onPress={() => router.push(m.route)} style={[styles.module, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                        <Ionicons name={m.icon} size={20} color={colors.brand} />
                        <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.onSurface, flex: 1 }}>{m.label}</AppText>
                        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
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
  badge: { position: "absolute", top: 8, right: 8, width: 9, height: 9, borderRadius: 5 },
  summary: { minHeight: 108, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  summaryIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kpi: { width: "48%", flexGrow: 1, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, gap: spacing.xs },
  kpiIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  moduleGrid: { gap: spacing.sm },
  module: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
