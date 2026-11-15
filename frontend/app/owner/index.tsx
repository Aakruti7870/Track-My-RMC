import React, { useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { HomeModuleSection, HomeSectionHeader } from "@/src/components/HomeModuleSection";
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

const PLANT_HERO_IMAGE = require("../../assets/images/Plant _Owner_All_staff_top_card.webp");
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
  const shortcutColumns = contentWidth / fontScale >= 350 ? 4 : 2;
  const shortcutWidth = (contentWidth - (shortcutColumns - 1) * 8) / shortcutColumns;
  const readableWidth = contentWidth / fontScale;
  const metricColumns = readableWidth >= 700 ? 4 : readableWidth >= 275 ? 2 : 1;
  const metricWidth = (contentWidth - (metricColumns - 1) * 9) / metricColumns;
  const { user } = useAuth();
  const router = useRouter();
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const { data, loading, error, reload, refetch } = useGet<HomeData>("/owner/home");
  const catalog = modulesForRole(user?.role);
  const modules = HOME_KEYS.flatMap(key => catalog.filter(module => module.key === key));
  const name = user?.name && !/play\s*review|reviewer/i.test(user.name) ? user.name : "Plant Owner";

  const openMetric = (destination: string) => {
    if (destination.startsWith("/")) {
      router.push(destination as any);
    } else {
      router.push({ pathname: "/owner/orders", params: destination === "today"
        ? { today: "1", status: "all" } : { status: destination, today: "" } });
    }
  };

  return <OwnerFrame>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[ui.content, { paddingBottom: bottom, gap: 10 }]}
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refetch} tintColor={p.accent} />}>
      <View testID="owner-home-summary" style={[styles.hero, { backgroundColor: p.panel, borderColor: p.border }]}>
        <View style={styles.heroCopy}>
          <AppText style={{ fontSize: 13, color: p.muted }}>Plant operations</AppText>
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, color: p.text }}>{name}</AppText>
        </View>
        <Image testID="owner-home-hero-banner" source={PLANT_HERO_IMAGE} resizeMode="cover" accessible={false} style={styles.heroImage} />
      </View>

      <HomeSectionHeader title="Quick Access" seeAll="/owner/operations" testID="home-see-all-owner-operations" />
      <View style={styles.modules}>
        {modules.map(module => <Pressable testID={`owner-shortcut-${module.key}`} key={module.key}
          accessibilityRole="button" accessibilityLabel={module.key === "business-staff" ? "Workforce" : module.label}
          accessibilityHint={module.description}
          onPress={() => router.push(ownerDestination(module))}
          style={({ pressed }) => [styles.shortcut, { width: shortcutWidth, opacity: pressed ? 0.74 : 1 }]}>
          {module.symbol ? <IconTile symbol={module.symbol} /> : <IconTile icon={module.icon} />}
          <AppText center style={[styles.shortcutLabel, { color: p.text }]}>{module.key === "business-staff" ? "Workforce" : module.label}</AppText>
        </Pressable>)}
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
              <AppText style={{ fontSize: 12, lineHeight: 16, color: p.text }}>{metric.label}</AppText>
              {loading && !data ? <Skeleton height={22} /> : <AppText style={{ fontFamily: fonts.bold, fontSize: 22, color: emphasis }}>{data?.cards[metric.key] ?? "—"}</AppText>}
              <AppText style={{ fontSize: 11, lineHeight: 15, color: p.muted }}>{metric.basis}</AppText>
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
    </ScrollView>
  </OwnerFrame>;
}
const styles = StyleSheet.create({
  hero: { minHeight: 104, borderWidth: 1, borderRadius: 12, padding: 12, gap: 12, flexDirection: "row", alignItems: "center" },
  heroImage: { width: 96, height: 72, borderRadius: 8 },
  heroCopy: { flex: 1, minWidth: 0, gap: 4 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  metric: { minHeight: 75, padding: 8, flexDirection: "row", gap: 6, alignItems: "center" },
  modules: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  shortcut: { minHeight: 80, paddingHorizontal: 2, paddingVertical: 5, alignItems: "center", gap: 5 },
  shortcutLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  insightsToggle: { flexDirection: "row", alignItems: "center", minHeight: 52, gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
});
