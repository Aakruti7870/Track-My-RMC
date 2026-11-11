import React, { useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { fonts } from "@/src/theme/tokens";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { operationalStatus, type OperationalStatus } from "@/src/theme/tokens";
import { HOME_KEYS, DRIVER_MODULE, ownerDestination } from "@/src/owner/modules";
import { OwnerCommercial } from "@/src/owner/OwnerCommercial";
import { OwnerInsights } from "@/src/owner/OwnerInsights";
import { OwnerFrame, OwnerGlass, OwnerModuleRow, ui, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";

const PLANT_HERO_IMAGE = require("../../assets/images/Plant _Owner_All_staff_top_card.webp");
type HomeData = { cards: Record<string, number>; plant_count: number };
const SHORT_COPY = ["Approve & manage", "Batching & workflows", "Stock & reorders", "Staff, attendance"];
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
  const bottom = useOwnerBottomSpace();
  const { width: viewportWidth } = useWindowDimensions();
  const contentWidth = Math.max(0, Math.min(viewportWidth, 820) - 32);
  const columns = contentWidth >= 700 ? 5 : contentWidth >= 450 ? 3 : 2;
  const tileWidth = (contentWidth - (columns - 1) * 8) / columns;
  const metricColumns = contentWidth >= 700 ? 4 : 2;
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
      <View testID="owner-home-summary" style={[styles.hero, { backgroundColor: p.dark ? "rgba(95,52,16,0.26)" : "rgba(255,237,209,0.62)" }]}>
        <View style={styles.heroArt}><Image testID="owner-home-hero-banner" source={PLANT_HERO_IMAGE} resizeMode="cover" accessibilityIgnoresInvertColors style={styles.heroImage} /></View>
        <View style={[styles.heroCopy, { backgroundColor: p.dark ? "rgba(14,17,22,0.84)" : "rgba(255,249,238,0.90)" }]}>
          <AppText style={{ fontSize: 18, color: p.text }}>Welcome Back,</AppText>
          <AppText numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 25, lineHeight: 30, color: p.text }}>{name}</AppText>
          <AppText style={{ fontSize: 11, lineHeight: 17, color: p.muted, marginTop: 5 }}>Manage your plant operations efficiently</AppText>
        </View>
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
            <VectorSymbol name={metric.symbol} size={30} warmAccent />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <AppText style={{ fontSize: 10, color: p.text }} numberOfLines={2}>{metric.label}</AppText>
              {loading && !data ? <Skeleton height={22} /> : <AppText style={{ fontFamily: fonts.bold, fontSize: 22, color: emphasis }}>{data?.cards[metric.key] ?? "—"}</AppText>}
              <AppText style={{ fontSize: 9, color: p.muted }}>{metric.basis}</AppText>
            </View>
          </OwnerGlass>
        </Pressable>; })}
      </View>

      <AppText style={[ui.section, { color: p.text }]}>Quick Access</AppText>
      <View style={styles.modules}>
        {modules.map((module, i) => <Pressable testID={`owner-shortcut-${module.key}`} key={module.key}
          accessibilityRole="button" accessibilityLabel={module.key === "business-staff" ? "Workforce" : module.label}
          onPress={() => router.push(ownerDestination(module))} style={{ width: tileWidth }}>
          <OwnerGlass style={styles.shortcut}>
            {module.symbol ? <VectorSymbol name={module.symbol} size={35} warmAccent /> : null}
            <AppText center numberOfLines={2} style={[styles.shortcutLabel, { color: p.text }]}>{module.key === "business-staff" ? "Workforce" : module.label}</AppText>
            <AppText center numberOfLines={2} style={[styles.shortcutCopy, { color: p.muted }]}>{SHORT_COPY[i]}</AppText>
          </OwnerGlass>
        </Pressable>)}
        <Pressable testID="owner-shortcut-insights" accessibilityRole="button" accessibilityState={{ expanded: insightsExpanded }}
          accessibilityLabel="Plant Overview & Weekly Insights" onPress={() => setInsightsExpanded(v => !v)}
          style={{ width: tileWidth }}>
          <OwnerGlass style={[styles.shortcut, insightsExpanded && { borderColor: p.accent }]}>
            <VectorSymbol name="production-report" size={35} warmAccent />
            <AppText center numberOfLines={3} style={[styles.shortcutLabel, { color: p.text }]}>Plant Overview & Weekly Insights</AppText>
          </OwnerGlass>
        </Pressable>
      </View>
      <OwnerInsights expanded={insightsExpanded} />

      <AppText style={[ui.section, { color: p.text }]}>Commercial</AppText>
      <OwnerCommercial />

      <AppText style={[ui.section, { color: p.text }]}>Driver Management</AppText>
      <OwnerModuleRow module={DRIVER_MODULE} compact />
    </ScrollView>
  </OwnerFrame>;
}
const styles = StyleSheet.create({
  hero: { minHeight: 150, aspectRatio: 2107 / 746, borderRadius: 20, overflow: "hidden", justifyContent: "center" },
  heroArt: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  heroImage: { width: "100%", height: "100%" },
  heroCopy: { width: "50%", minWidth: 155, maxWidth: 360, padding: 13, borderRadius: 16, margin: 5 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  metric: { minHeight: 75, padding: 8, flexDirection: "row", gap: 6, alignItems: "center" },
  modules: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  shortcut: { minHeight: 88, height: "100%", paddingHorizontal: 5, paddingVertical: 7, alignItems: "center", justifyContent: "center", gap: 3 },
  shortcutLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
  shortcutCopy: { fontSize: 9, lineHeight: 12 },
});
