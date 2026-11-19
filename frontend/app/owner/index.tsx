import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { HomeModuleSection } from "@/src/components/HomeModuleSection";
import { HomeScroll } from "@/src/components/HomeScroll";
import { PlantHomeBanner, PlantHomeHero } from "@/src/components/PlantHomeCards";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { type VectorSymbolName } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { fonts, operationalStatus, type OperationalStatus } from "@/src/theme/tokens";
import { useTheme } from "@/src/theme/ThemeProvider";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { HOME_SHORTCUTS, DRIVER_MODULE, OWNER_HOME_COMMERCIAL, OWNER_HOME_WORKFORCE, ownerModules } from "@/src/owner/modules";
import { OwnerInsights } from "@/src/owner/OwnerInsights";
import { OwnerFrame, OwnerGlass, OwnerModuleRow, ui, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";

import { LoadPipeline, WorkspaceTile, businessPath, pipelinePath, recordPath, usePlantWorkspace } from "@/src/owner/PlantOperations";

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
  const { plant, loading: plantsLoading, error: plantsError, reload: retryPlants, refetch: refreshPlants } = usePlantWorkspace();
  const readableWidth = contentWidth / fontScale;
  const metricColumns = readableWidth >= 700 ? 4 : readableWidth >= 275 ? 2 : 1;
  const metricWidth = (contentWidth - (metricColumns - 1) * 9) / metricColumns;
  const { user } = useAuth();
  const router = useRouter();
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const { data, loading, error, reload, refetch } = useGet<HomeData>("/owner/home");
  const catalog = modulesForRole(user?.role);
  const modules = HOME_SHORTCUTS.flatMap(([key, label]) => catalog.filter(module => module.key === key).map(module => ({ ...module, label })));
  useFocusEffect(useCallback(() => { void refetch(); void refreshPlants(); }, [refetch, refreshPlants]));
  const operations = (section = ""): Href => ({ pathname: "/owner/operations", params: { section, plantId: plant?.id ?? "" } });
  const profile: Href = { pathname: "/plant-profile", params: { assigned: "1", ...(plant ? { plantId: plant.id } : {}) } };
  const plantShortcut = (module: typeof modules[number]): Href => {
    if (!plant) return module.route;
    switch (module.key) {
      case "business-inventory": return businessPath("inventory", plant.id);
      case "business-reports": return businessPath("reports", plant.id);
      case "business-fleet": return businessPath("fleet", plant.id);
      case "business-quotations": return businessPath("quotations", plant.id);
      default: return module.route;
    }
  };

  const openMetric = (destination: string) => {
    if (destination.startsWith("/")) {
      router.push(destination as Href);
    } else {
      router.push({ pathname: "/owner/orders", params: destination === "today"
        ? { today: "1", status: "all" } : { status: destination, today: "" } });
    }
  };

  return <OwnerFrame matte>
    <HomeScroll testID="owner-home-scroll" paddingHorizontal={16} gap={10}
      contentContainerStyle={{ paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => void Promise.all([refetch(), refreshPlants()])} tintColor={p.accent} />}
    >
      <View testID="owner-home-summary" style={[styles.homeCards, styles.hero, { backgroundColor: p.panel }]}>
        <PlantHomeHero label="Plant Owner" testID="owner-home-hero-banner" profile={profile} />
      </View>
      <View style={styles.homeCards}>
        <OwnerGlass testID="owner-quick-access" style={styles.quickAccess} highlighted={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {modules.map(module => <Pressable testID={`owner-shortcut-${module.key}`} key={module.key}
              accessibilityRole="button" accessibilityLabel={module.label} accessibilityHint={module.description}
              onPress={() => router.push(plantShortcut(module))}
              style={({ pressed }) => [styles.shortcut, { width: fontScale > 1.25 ? 108 : 88, opacity: pressed ? 0.74 : 1,
                backgroundColor: colors.surface, borderColor: p.border }]}>
              {module.symbol ? <IconTile symbol={module.symbol} size={23} width={35} height={34} homeShortcut /> : <IconTile icon={module.icon} homeShortcut />}
              <AppText center style={styles.quickLabel}>{module.label}</AppText>
            </Pressable>)}
          </ScrollView>
        </OwnerGlass>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
          <View style={{ width: 156 }}>
            <WorkspaceTile testID="plant-home-supplier-enquiry" title="Material Suppliers" symbol="supplier-enquiry" destination="/supplier-enquiry" tone="warning" />
          </View>
          <View style={{ width: 167 }}>
            <WorkspaceTile title="Dispatch Automation" symbol="automation" destination={operations("automation")} tone="approval" />
          </View>
          <View style={{ width: 141 }}>
            <WorkspaceTile title="Daily Overview" symbol="plant-reports" destination={plant ? businessPath("reports", plant.id) : "/business/reports"} />
          </View>
        </ScrollView>
        <View style={styles.taskGrid}>
          {[
            { title: "Pending Orders", symbol: "pending-approval", route: { pathname: "/owner/orders", params: { status: "pending", today: "" } } },
            { title: "Production & Dispatch", symbol: "production-and-dispatch", route: plant ? pipelinePath(plant.id) : { pathname: "/owner/orders", params: { status: "processing", today: "" } } },
            ...(plant ? [{ title: "DC Book", symbol: "delivery-challan" as const, route: recordPath("challans", plant.id) }] : []),
            { title: "Scheduled Volume", symbol: "production-report", route: { pathname: "/owner/orders", params: { status: "all", today: "1" } } },
          ].map(task => <View key={task.title} style={{ width: readableWidth >= 300 ? "23.5%" : "49%" }}>
            <WorkspaceTile stacked title={task.title} symbol={task.symbol as VectorSymbolName} destination={task.route as Href} />
          </View>)}
        </View>
        <OwnerGlass style={styles.banners} highlighted={false}>
          <PlantHomeBanner type="attendance" destination={plant ? businessPath("attendance", plant.id) : "/workforce"} />
          <PlantHomeBanner type="whatsapp" destination={operations("whatsapp")} />
        </OwnerGlass>
        <View style={styles.cardRow}>
          <WorkspaceTile title="Billing & Ledger" symbol="billing-and-ledger" destination="/owner/billing" />
          {plant ? <WorkspaceTile title="Public Plant Profile" symbol="plant-profile"
            destination={{ pathname: "/plant-profile", params: { plantId: plant.id } }} /> : null}
        </View>
        {plantsError ? <ErrorView message={plantsError} onRetry={retryPlants} /> : null}
        {plant ? <LoadPipeline plantId={plant.id} plantName={plant.name} /> : !plantsError ? <AppText variant="caption">
          {plantsLoading ? "Loading plants…" : "Load Pipeline will appear once a plant is assigned."}
        </AppText> : null}
      </View>
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
  quickAccess: { borderRadius: 10, padding: 5 },
  rail: { gap: 7, paddingHorizontal: 1 },
  taskGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: "2%", rowGap: 6 },
  cardRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  banners: { padding: 4, gap: 4 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  metric: { minHeight: 75, padding: 8, flexDirection: "row", gap: 6, alignItems: "center" },
  shortcut: { borderWidth: 1, borderRadius: 8, minHeight: 65, paddingHorizontal: 4, paddingVertical: 5, alignItems: "center", gap: 4 },
  quickLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, width: "100%" },
  shortcutLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  insightsToggle: { flexDirection: "row", alignItems: "center", minHeight: 52, gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
});
