import React from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { fonts } from "@/src/theme/tokens";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { ownerDestination } from "@/src/owner/modules";
import { OwnerFrame, OwnerGlass, ui, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";

type HomeData = { cards: Record<string, number>; plant_count: number };
const HOME_KEYS = ["owner-orders", "owner-production-dispatch", "business-inventory", "business-staff", "owner-billing", "business-reports"];
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
  const { user } = useAuth();
  const router = useRouter();
  const { data, loading, error, reload, refetch } = useGet<HomeData>("/owner/home");
  const catalog = modulesForRole(user?.role);
  const modules = HOME_KEYS.flatMap(key => catalog.filter(module => module.key === key));
  // The display name may be a reviewer fixture; never expose review labels as branding.
  const name = user?.name && !/play\s*review|reviewer/i.test(user.name) ? user.name : "Plant Owner";
  const pending = data?.cards.pending_approvals;
  return <OwnerFrame>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[ui.content, { paddingBottom: bottom, gap: 10 }]} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refetch} tintColor={p.accent} />}>
      <View style={[styles.hero, { backgroundColor: p.dark ? "rgba(95,52,16,0.26)" : "rgba(255,237,209,0.62)" }]}>
        <View style={styles.heroArt}><Image source={require("../../assets/images/Mixer.png")} resizeMode="cover" accessibilityIgnoresInvertColors style={styles.heroImage} /></View>
        <View style={[styles.heroCopy, { backgroundColor: p.dark ? "rgba(14,17,22,0.84)" : "rgba(255,249,238,0.90)" }]}>
          <AppText style={{ fontSize: 18, color: p.text }}>Welcome Back,</AppText>
          <AppText numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 25, lineHeight: 30, color: p.text }}>{name}</AppText>
          <AppText style={{ fontSize: 11, lineHeight: 17, color: p.muted, marginTop: 5 }}>Manage your plant operations efficiently</AppText>
        </View>
      </View>
      <AppText style={[ui.section, { color: p.text }]}>Today at a Glance</AppText>
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      <View style={styles.metrics}>
        {METRICS.map(metric => <Pressable key={metric.key} accessibilityRole="button" accessibilityLabel={`${metric.label}, ${data?.cards[metric.key] ?? "unavailable"}, ${metric.basis}`} onPress={() => metric.route === "staff" ? router.push("/business/staff") : router.push({ pathname: "/owner/orders", params: metric.route === "today" ? { today: "1", status: "all" } : { status: metric.route, today: "" } })} style={{ width: "48.4%", flexGrow: 1 }}>
          <OwnerGlass style={styles.metric}>
            <VectorSymbol name={metric.symbol} size={44} warmAccent />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <AppText style={{ fontSize: 10, color: p.text }}>{metric.label}</AppText>
              {loading && !data ? <Skeleton height={22} /> : <AppText style={{ fontFamily: fonts.bold, fontSize: 22, color: p.text }}>{data?.cards[metric.key] ?? "—"}</AppText>}
              <AppText style={{ fontSize: 9, color: p.muted }}>{metric.basis}</AppText>
            </View>
          </OwnerGlass>
        </Pressable>)}
      </View>
      <View style={styles.sectionHeader}><AppText style={{ fontFamily: fonts.bold, fontSize: 20, color: p.text }}>Your Modules</AppText><Pressable accessibilityRole="button" accessibilityLabel="View all plant modules" onPress={() => router.push({ pathname: "/owner/more", params: { directory: "1" } })} style={{ paddingVertical: 10 }}><AppText style={{ color: p.dark ? "#FFAD70" : "#AC4700", fontSize: 12 }}>View all</AppText></Pressable></View>
      <View style={styles.modules}>
        {modules.map((module, i) => <Pressable testID={`owner-shortcut-${module.key}`} key={module.key} accessibilityRole="button" accessibilityLabel={module.key === "business-staff" ? "Workforce" : module.label} onPress={() => router.push(ownerDestination(module))} style={{ width: "31.5%", flexGrow: 1 }}>
          <OwnerGlass style={styles.shortcut}>
            {module.symbol ? <VectorSymbol name={module.symbol} size={51} warmAccent /> : null}
            <AppText center style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: p.text }}>{module.key === "business-staff" ? "Workforce" : module.label}</AppText>
            <AppText center style={{ fontSize: 9, lineHeight: 14, color: p.muted }}>{SHORT_COPY[i]}</AppText>
          </OwnerGlass>
        </Pressable>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open pending approval queue" onPress={() => router.push({ pathname: "/owner/orders", params: { status: "pending", today: "" } })}>
        <OwnerGlass style={styles.approvals}><Ionicons name="time" size={32} color={p.accent} /><View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: p.text }}>Pending Approvals</AppText><AppText style={{ fontSize: 12, color: p.muted }}><AppText style={{ fontFamily: fonts.bold, fontSize: 22, color: p.text }}>{pending ?? "—"}  </AppText>{pending === 0 ? "No orders awaiting approval" : pending != null ? "Orders awaiting your review" : "Count unavailable"}</AppText></View><Ionicons name="chevron-forward" size={18} color={p.text} /></OwnerGlass>
      </Pressable>
    </ScrollView>
  </OwnerFrame>;
}
const styles = StyleSheet.create({
  hero: { minHeight: 150, borderRadius: 20, overflow: "hidden", justifyContent: "center" },
  heroArt: { position: "absolute", right: 0, top: 0, bottom: 0, width: "58%", overflow: "hidden" },
  heroImage: { position: "absolute", right: -15, bottom: -12, width: 390, height: 220 },
  heroCopy: { width: "56%", padding: 13, borderRadius: 16, margin: 5 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { minHeight: 78, padding: 8, flexDirection: "row", gap: 6, alignItems: "center" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: -6 },
  modules: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  shortcut: { minHeight: 116, height: "100%", padding: 8, alignItems: "center", gap: 5 },
  approvals: { padding: 12, minHeight: 75, flexDirection: "row", alignItems: "center", gap: 10 },
});
