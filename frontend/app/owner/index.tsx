import React, { useState } from "react";
import { Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { HomeModuleSection, HomeSectionHeader } from "@/src/components/HomeModuleSection";
import { HomeScroll } from "@/src/components/HomeScroll";
import { PlantHomeActions, PlantHomeHero } from "@/src/components/PlantHomeCards";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { type VectorSymbolName } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { fonts, operationalStatus, type OperationalStatus } from "@/src/theme/tokens";
import { useTheme } from "@/src/theme/ThemeProvider";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { HOME_KEYS, DRIVER_MODULE, ownerDestination, OWNER_HOME_COMMERCIAL, OWNER_HOME_WORKFORCE, ownerModules } from "@/src/owner/modules";
import { OwnerInsights } from "@/src/owner/OwnerInsights";
import { OwnerFrame, OwnerGlass, OwnerModuleRow, ui, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";

type HomeData = { cards: Record<string, number>; plant_count: number };
const METRICS: { key: string; label: string; basis: string; symbol: VectorSymbolName; destination: string }[] = [
  { key: "todays_orders", label: "Total Orders", basis: "Due today", symbol: "plant-orders", destination: "today" },
  { key: "dispatched_loads", label: "Dispatches", basis: "Loads dispatched today", symbol: "production-dispatch", destination: "/owner/dispatches" },
  { key: "pending_approvals", label: "Pending Order Approvals", basis: "Orders awaiting review", symbol: "pending-approval", destination: "pending" },
  { key: "active_staff", label: "Plant Staff", basis: "Active linked staff", symbol: "plant-staff", destination: "/business/staff" },
  { key: "plant_attendance_today", label: "Plant Attendance", basis: "Checked in today", symbol: "attendance", destination: "/business/attendance" },
  { key: "plant_expenses_today", label: "Expenses", basis: "Records today", symbol: "expenses", destination: "/business/expenses" },
  { key: "active_mixers", label: "Active Mixers", basis: "On active deliveries", symbol: "transit-mixer-fleet", destination: "/business/fleet" },
  { key: "ordered_qty", label: "Ordered Volume", basis: "m³ due today", symbol: "plant-orders", destination: "today" },
];

export default function OwnerHome() {
  const p = useOwnerPalette();
  const { colors } = useTheme();
  const bottom = useOwnerBottomSpace();
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const contentWidth = Math.max(0, Math.min(viewportWidth, 820) - 32);
  const shortcutWidth = (Math.min(contentWidth, 620) - 20) / fontScale >= 320 ? "24%" : "49%";
  const readableWidth = contentWidth / fontScale;
  const metricColumns = readableWidth >= 700 ? 4 : readableWidth >= 275 ? 2 : 1;
  const metricWidth = (contentWidth - (metricColumns - 1) * 9) / metricColumns;
  const { user } = useAuth();
  const router = useRouter();
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const { data, loading, error, reload, refetch } = useGet<HomeData>("/owner/home");
  const catalog = modulesForRole(user?.role);
  const modules = HOME_KEYS.flatMap(key => catalog.filter(module => module.key === key));

  const openMetric = (destination: string) => {
    if (destination.startsWith("/")) {
      router.push(destination as any);
    } else {
      router.push({ pathname: "/owner/orders", params: destination === "today"
        ? { today: "1", status: "all" } : { status: destination, today: "" } });
    }
  };

  return <OwnerFrame>
    <HomeScroll testID="owner-home-scroll" paddingHorizontal={16} gap={10}
      backgroundColor={p.canvas} tabBarOverlay={bottom}
      contentContainerStyle={{ paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refetch} tintColor={p.accent} />}
      lead={<View testID="owner-home-summary" style={[styles.homeCards, styles.hero, { backgroundColor: p.panel }]}>
        <PlantHomeHero label="Plant Owner" testID="owner-home-hero-banner" />
      </View>}
      shortcuts={<View style={styles.homeCards}>
        <View testID="owner-quick-access" style={[styles.quickAccess, { backgroundColor: p.panel, borderColor: p.border }]}>
          <HomeSectionHeader title="Quick Access" seeAll="/owner/operations" testID="home-see-all-owner-operations" />
          <View style={styles.modules}>
            {modules.map(module => <Pressable testID={`owner-shortcut-${module.key}`} key={module.key}
              accessibilityRole="button" accessibilityLabel={module.key === "business-staff" ? "Workforce" : module.label}
              accessibilityHint={module.description}
              onPress={() => router.push(ownerDestination(module))}
              style={({ pressed }) => [styles.shortcut, { width: shortcutWidth, opacity: pressed ? 0.74 : 1 }]}>
              {module.symbol ? <IconTile symbol={module.symbol} height={45} homeShortcut /> : <IconTile icon={module.icon} height={45} homeShortcut />}
              <AppText center style={styles.quickLabel}>{module.key === "business-staff" ? "Workforce" : module.label}</AppText>
            </Pressable>)}
          </View>
        </View>
        <PlantHomeActions action="supplier-enquiry" homeShortcut />
      </View>}>
      <PlantHomeActions action="profile" homeShortcut />
      <AppText style={[ui.section, { color: p.text }]}>Today at a Glance</AppText>
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      <View style={styles.metrics}>
        {METRICS.map(metric => {
          const value = Number(data?.cards[metric.key] ?? 0);
          const tone: OperationalStatus = metric.key === "pending_approvals" ? "warning"
            : metric.key === "active_mixers" || metric.key === "dispatched_loads" || metric.key === "todays_orders" ? "success"
            : metric.key === "ordered_qty" ? "approval" : "neutral";
          const emphasis = value > 0 ? operationalStatus(tone, p.dark) : p.muted;
          return <Pressable key={metric.key} testID={`owner-metric-${metric.key}`}
          accessibilityRole="button" accessibilityLabel={`${metric.label}, ${data?.cards[metric.key] ?? "unavailable"}, ${metric.basis}`}
          onPress={() => openMetric(metric.destination)} style={{ width: metricWidth }}>
          <OwnerGlass style={[styles.metric, value > 0 && tone !== "neutral" ? { borderColor: emphasis + "70" } : null]}>
            <IconTile symbol={metric.symbol} width={38} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <AppText style={{ fontSize: 10, color: p.text }} numberOfLines={2}>{metric.label}</AppText>
              {loading && !data ? <Skeleton height={22} /> : <AppText style={{ fontFamily: fonts.bold, fontSize: 22, color: emphasis }}>{data?.cards[metric.key] ?? "—"}</AppText>}
              <AppText style={{ fontSize: 9, color: p.muted }}>{metric.basis}</AppText>
            </View>
          </OwnerGlass>
        </Pressable>; })}
      </View>

      <Pressable testID="owner-shortcut-insights" accessibilityRole="button" accessibilityState={{ expanded: insightsExpanded }}
        accessibilityLabel="Plant Overview & Weekly Insights" onPress={() => setInsightsExpanded(v => !v)}>
        <OwnerGlass style={[styles.insightsToggle, insightsExpanded && { borderColor: colors.controlOutline }]}>
          <IconTile symbol="production-report" width={36} />
          <AppText style={[styles.shortcutLabel, { color: p.text }]}>Plant Overview & Weekly Insights</AppText>
        </OwnerGlass>
      </Pressable>
      <OwnerInsights expanded={insightsExpanded} />

      <HomeModuleSection id="owner-commercial" title="Commercial" modules={ownerModules(OWNER_HOME_COMMERCIAL)}
        seeAll={{ pathname: "/role-modules", params: { category: "Commercial" } }} />
      <HomeModuleSection id="owner-workforce" title="Workforce" modules={ownerModules(OWNER_HOME_WORKFORCE)}
        seeAll={{ pathname: "/role-modules", params: { category: "Workforce" } }} />

      <AppText style={[ui.section, { color: p.text }]}>Driver Management</AppText>
      <OwnerModuleRow module={DRIVER_MODULE} compact />
    </HomeScroll>
  </OwnerFrame>;
}
const styles = StyleSheet.create({
  homeCards: { alignSelf: "center", width: "100%", maxWidth: 620, gap: 10 },
  hero: { borderRadius: 10 },
  quickAccess: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 9, paddingBottom: 9 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  metric: { minHeight: 75, padding: 8, flexDirection: "row", gap: 6, alignItems: "center" },
  modules: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 6 },
  shortcut: { minHeight: 80, minWidth: 0, paddingHorizontal: 2, paddingVertical: 4, alignItems: "center", gap: 5 },
  quickLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, width: "100%" },
  shortcutLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  insightsToggle: { flexDirection: "row", alignItems: "center", minHeight: 52, gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
});
