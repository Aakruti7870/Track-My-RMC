import React, { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const STORAGE_KEY = "trackmyrmc:free-tools:v1";
type SavedCalculation = { id: string; name: string; quantity: number; grade?: string; checklist?: Record<string, boolean> };
type Delivery = { order_id: string; order_number?: string; delivery_date?: string; delivery_time?: string; grade?: string; quantity?: number; status?: string };
type ProjectSite = {
  id: string; name: string; address: string; contact_person?: string | null; contact_mobile?: string | null; is_default?: boolean;
  orders_count: number; active_orders: number; delivered_orders: number; ordered_m3: number; delivered_m3: number;
  pour_plans: number; receiving_records: number; pending_cube_tests: number; overdue_cube_tests: number; quotation_requests: number; official_quotations: number; open_quotations: number; upcoming_delivery?: Delivery | null;
  latest_order?: { id: string; order_number?: string; status?: string } | null;
};
const normalized = (value?: string) => (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export default function CustomerProjects() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<{ sites: ProjectSite[]; count: number }>("/customer/project-sites");
  const [saved, setSaved] = useState<SavedCalculation[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => setSaved(raw ? JSON.parse(raw) : [])).catch(() => setSaved([]));
  }, []);

  const localBySite = useMemo(() => {
    const map: Record<string, SavedCalculation[]> = {};
    for (const site of data?.sites || []) {
      const key = normalized(site.name);
      map[site.id] = saved.filter((item) => {
        const name = normalized(item.name);
        return !!key && (name.includes(key) || key.includes(name));
      });
    }
    return map;
  }, [data, saved]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.divider }]}>
        <Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.onSurface} /></Pressable>
        <View style={{ flex: 1 }}><AppText style={[styles.headerTitle, { color: colors.onSurface }]}>Project & Site Hub</AppText><AppText style={[styles.headerSub, { color: colors.onSurfaceTertiary }]}>Everything for each concrete delivery site</AppText></View>
        <Ionicons name="briefcase-outline" size={25} color={colors.brand} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 110, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}>
        <Card style={{ gap: spacing.sm }}>
          <View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={colors.brand} /><AppText variant="caption" style={{ flex: 1 }}>Orders and quotations are linked by saved site. Older records are safely matched by the same site name and address.</AppText></View>
        </Card>
        {loading && !data ? <><Skeleton height={210} /><Skeleton height={210} /></> : null}
        {error && !data ? <Card style={{ gap: spacing.md }}><AppText color={colors.error}>{error}</AppText><Button label="Retry" onPress={reload} /></Card> : null}
        {data?.sites.map((site) => {
          const open = expanded === site.id;
          const calculations = localBySite[site.id] || [];
          const calculatedM3 = calculations.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
          const checklistDone = calculations.reduce((sum, item) => sum + Object.values(item.checklist || {}).filter(Boolean).length, 0);
          return <Card key={site.id} style={{ gap: spacing.md, borderColor: open ? colors.brand : colors.border }}>
            <Pressable onPress={() => setExpanded(open ? null : site.id)} style={styles.between}>
              <View style={styles.siteTitle}><View style={[styles.siteIcon, { backgroundColor: colors.brandSoft }]}><Ionicons name="business-outline" size={21} color={colors.brand} /></View><View style={{ flex: 1 }}><View style={styles.titleLine}><AppText variant="heading">{site.name}</AppText>{site.is_default ? <Badge label="Default" color={colors.brand} /> : null}</View><AppText variant="caption" numberOfLines={2}>{site.address}</AppText></View></View>
              <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceTertiary} />
            </Pressable>

            <View style={styles.metrics}>
              <Metric label="Orders" value={String(site.orders_count)} />
              <Metric label="Active" value={String(site.active_orders)} accent />
              <Metric label="Delivered" value={`${site.delivered_m3} m³`} />
            </View>

            {site.upcoming_delivery ? <Pressable onPress={() => router.push(`/order/${site.upcoming_delivery!.order_id}` as any)} style={[styles.upcoming, { backgroundColor: colors.brandSoft }]}>
              <Ionicons name="calendar-outline" size={20} color={colors.brand} />
              <View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold }}>Upcoming delivery</AppText><AppText variant="caption">{site.upcoming_delivery.delivery_date} {site.upcoming_delivery.delivery_time || ""} · {site.upcoming_delivery.grade} · {site.upcoming_delivery.quantity} m³</AppText></View>
              <Ionicons name="chevron-forward" size={18} color={colors.brand} />
            </Pressable> : null}

            {open ? <>
              <View style={[styles.summaryBox, { backgroundColor: colors.surfaceTertiary }]}>
                <SummaryLine label="Total concrete ordered" value={`${site.ordered_m3} m³`} />
                <SummaryLine label="Saved pour plans" value={String(site.pour_plans)} />
                <SummaryLine label="Receiving observations" value={String(site.receiving_records)} />
                <SummaryLine label="Cube tests pending / overdue" value={`${site.pending_cube_tests} / ${site.overdue_cube_tests}`} />
                <SummaryLine label="Quotation requests" value={String(site.quotation_requests)} />
                <SummaryLine label="Official / open quotations" value={`${site.official_quotations} / ${site.open_quotations}`} />
                <SummaryLine label="Saved calculations on device" value={String(calculations.length)} />
                {calculations.length ? <SummaryLine label="Calculated quantity" value={`${calculatedM3.toFixed(2)} m³`} /> : null}
                {checklistDone ? <SummaryLine label="Checklist items completed" value={String(checklistDone)} /> : null}
              </View>
              {calculations.slice(0, 3).map((item) => <View key={item.id} style={[styles.calcRow, { borderColor: colors.border }]}><Ionicons name="calculator-outline" size={18} color={colors.brand} /><View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.medium }}>{item.name}</AppText><AppText variant="caption">{item.grade || "Grade not selected"} · {item.quantity} m³</AppText></View></View>)}
              <View style={styles.actions}><View style={{ flex: 1 }}><Button label="Pour Planner" variant="outline" onPress={() => router.push("/customer/pour-planner")} /></View><View style={{ flex: 1 }}><Button label="Receiving Guide" variant="outline" onPress={() => router.push("/customer/receiving-guide")} /></View></View>
              <Button label="Cube Test Follow-up" variant="outline" onPress={() => router.push("/customer/cube-test-follow-up")} />
              <View style={styles.actions}>
                <View style={{ flex: 1 }}><Button label="Calculate" variant="outline" onPress={() => router.push("/customer/free-tools")} /></View>
                <View style={{ flex: 1 }}><Button label="Compare" variant="outline" onPress={() => router.push({ pathname: "/customer/compare-plants", params: { siteId: site.id } } as any)} /></View>
              </View>
              <View style={styles.actions}>
                <View style={{ flex: 1 }}><Button label="Quotations" variant="outline" onPress={() => router.push("/customer/quotations")} /></View>
                <View style={{ flex: 1 }}><Button label="New Order" onPress={() => router.push({ pathname: "/new-order", params: { siteId: site.id, siteName: site.name, siteAddress: site.address } } as any)} /></View>
              </View>
              {site.latest_order ? <Button label={`Open Latest Order ${site.latest_order.order_number || ""}`} variant="ghost" onPress={() => router.push(`/order/${site.latest_order!.id}` as any)} /> : null}
            </> : null}
          </Card>;
        })}
        {data && data.sites.length === 0 ? <Card style={styles.empty}><Ionicons name="location-outline" size={34} color={colors.onSurfaceTertiary} /><AppText variant="heading">Create your first project site</AppText><AppText variant="caption" center>Save a delivery site to organise calculations, quotations and orders in one place.</AppText><Button label="Add Saved Site" onPress={() => router.push("/customer/sites")} /></Card> : null}
      </ScrollView>
    </View>
  );
}
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.metric, { backgroundColor: colors.surfaceTertiary }]}><AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.lg, color: accent ? colors.brand : colors.onSurface }}>{value}</AppText><AppText variant="caption">{label}</AppText></View>;
}
function SummaryLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.between}><AppText variant="caption">{label}</AppText><AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm }}>{value}</AppText></View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl }, headerSub: { fontSize: 12 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  siteTitle: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md }, siteIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  titleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  metrics: { flexDirection: "row", gap: spacing.sm }, metric: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  upcoming: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  summaryBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  calcRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderRadius: radius.md },
  actions: { flexDirection: "row", gap: spacing.sm },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing["2xl"] },
});
