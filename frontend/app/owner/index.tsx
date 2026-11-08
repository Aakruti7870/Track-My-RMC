import React from "react";
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
import { HOME_KEYS, ownerDestination } from "@/src/owner/modules";
import { OwnerFrame, OwnerGlass, ui, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";

const PLANT_HERO_IMAGE = require("../../assets/images/Plant _Owner_All_staff_top_card.webp");

type HomeData = { cards: Record<string, number>; plant_count: number };
const SHORT_COPY = ["Approve & manage", "Batching & workflows", "Stock & reorders", "Staff, attendance", "Invoices & payments", "Reports & summary"];
const METRICS: { key: string; label: string; basis: string; symbol: VectorSymbolName; route: string }[] = [
  { key: "todays_orders", label: "Total Orders", basis: "Due today", symbol: "plant-orders", route: "today" },
  { key: "dispatched_loads", label: "Dispatches", basis: "Loads sent today", symbol: "production-dispatch", route: "processing" },
  { key: "pending_approvals", label: "Pending Approvals", basis: "Awaiting review", symbol: "quotation-requests", route: "pending" },
  { key: "active_staff", label: "Plant Staff", basis: "Active linked staff", symbol: "plant-staff", route: "staff" },
];
export default function OwnerHome() {
  const p = useOwnerPalette();
  const bottom = useOwnerBottomSpace();
  const { width: viewportWidth } = useWindowDimensions();
  const contentWidth = Math.max(0, Math.min(viewportWidth, 820) - 32);
  const columns = contentWidth >= 680 ? 4 : contentWidth >= 450 ? 3 : 2;
  const tileWidth = (contentWidth - (columns - 1) * 9) / columns;
  const metricColumns = contentWidth >= 680 ? 4 : 2;
  const metricWidth = (contentWidth - (metricColumns - 1) * 10) / metricColumns;
  const { user } = useAuth();
  const router = useRouter();
  const { data, loading, error, reload, refetch } = useGet<HomeData>("/owner/home");
  const catalog = modulesForRole(user?.role);
  const modules = HOME_KEYS.flatMap(key => catalog.filter(module => module.key === key));
  // The display name may be a reviewer fixture; never expose review labels as branding.
  const name = user?.name && !/play\s*review|reviewer/i.test(user.name) ? user.name : "Plant Owner";
  return <OwnerFrame>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[ui.content, { paddingBottom: bottom, gap: 10 }]} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refetch} tintColor={p.accent} />}>
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
        {METRICS.map(metric => <Pressable key={metric.key} accessibilityRole="button" accessibilityLabel={`${metric.label}, ${data?.cards[metric.key] ?? "unavailable"}, ${metric.basis}`} onPress={() => metric.route === "staff" ? router.push("/business/staff") : router.push({ pathname: "/owner/orders", params: metric.route === "today" ? { today: "1", status: "all" } : { status: metric.route, today: "" } })} style={{ width: metricWidth }}>
          <OwnerGlass style={styles.metric}>
            <VectorSymbol name={metric.symbol} size={32} warmAccent />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <AppText style={{ fontSize: 10, color: p.text }}>{metric.label}</AppText>
              {loading && !data ? <Skeleton height={22} /> : <AppText style={{ fontFamily: fonts.bold, fontSize: 22, color: p.text }}>{data?.cards[metric.key] ?? "—"}</AppText>}
              <AppText style={{ fontSize: 9, color: p.muted }}>{metric.basis}</AppText>
            </View>
          </OwnerGlass>
        </Pressable>)}
      </View>
      <View style={styles.sectionHeader}><AppText style={{ fontFamily: fonts.bold, fontSize: 15, color: p.text }}>Quick Access</AppText><Pressable accessibilityRole="button" accessibilityLabel="Browse other plant modules" onPress={() => router.push("/owner/more")} style={{ paddingVertical: 10 }}><AppText style={{ color: p.dark ? "#FFAD70" : "#AC4700", fontSize: 12 }}>More modules</AppText></Pressable></View>
      <View style={styles.modules}>
        {modules.map((module, i) => <Pressable testID={`owner-shortcut-${module.key}`} key={module.key} accessibilityRole="button" accessibilityLabel={module.key === "business-staff" ? "Workforce" : module.label} onPress={() => router.push(ownerDestination(module))} style={{ width: tileWidth }}>
          <OwnerGlass style={styles.shortcut}>
            {module.symbol ? <VectorSymbol name={module.symbol} size={42} warmAccent /> : null}
            <AppText center style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: p.text }}>{module.key === "business-staff" ? "Workforce" : module.label}</AppText>
            <AppText center style={{ fontSize: 9, lineHeight: 14, color: p.muted }}>{SHORT_COPY[i]}</AppText>
          </OwnerGlass>
        </Pressable>)}
      </View>
    </ScrollView>
  </OwnerFrame>;
}
const styles = StyleSheet.create({
  hero: { minHeight: 150, aspectRatio: 2107 / 746, borderRadius: 20, overflow: "hidden", justifyContent: "center" },
  heroArt: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  heroImage: { width: "100%", height: "100%" },
  heroCopy: { width: "50%", minWidth: 155, maxWidth: 360, padding: 13, borderRadius: 16, margin: 5 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { minHeight: 76, padding: 8, flexDirection: "row", gap: 6, alignItems: "center" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: -6 },
  modules: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  shortcut: { minHeight: 108, height: "100%", padding: 7, alignItems: "center", justifyContent: "center", gap: 4 },
});
