import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { OrderCard, OrderData } from "@/src/components/OrderCard";
import { WeeklyInsights } from "@/src/components/WeeklyInsights";
import { ErrorView } from "@/src/components/StateViews";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type OwnerHomeData = {
  plant_count: number;
  plants: { id: string; name: string }[];
  cards: Record<string, number>;
  pending_orders: OrderData[];
};

const CARD_DEFS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; unit?: string }[] = [
  { key: "pending_approvals", label: "Pending Approvals", icon: "hourglass-outline" },
  { key: "todays_orders", label: "Today's Orders", icon: "today-outline" },
  { key: "ordered_qty", label: "Ordered", icon: "cube-outline", unit: "m³" },
  { key: "dispatched_qty", label: "Dispatched", icon: "navigate-outline", unit: "m³" },
  { key: "delivered_qty", label: "Delivered", icon: "checkmark-done-outline", unit: "m³" },
  { key: "active_mixers", label: "Active TMs", icon: "bus-outline" },
];

export default function OwnerHome() {
  const { colors, toggle, scheme } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<OwnerHomeData>("/owner/home");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <AppText variant="caption">Plant Owner</AppText>
          <AppText variant="title" numberOfLines={1}>{user?.name}</AppText>
        </View>
        <Pressable testID="owner-theme-toggle" onPress={toggle} style={[styles.iconBtn, { borderColor: colors.border }]}>
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
              <Card variant="brand" style={styles.summary} testID="owner-home-summary">
                <View style={styles.summaryIcon}><Ionicons name="business" size={22} color={colors.onBrandSoft} /></View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <AppText variant="caption">LIVE PLANT OVERVIEW</AppText>
                  <AppText style={styles.summaryTitle}>{data.plant_count} {data.plant_count === 1 ? "plant" : "plants"} connected</AppText>
                  <AppText variant="bodyMuted">{data.cards.pending_approvals ?? 0} orders need your approval</AppText>
                </View>
                <Pressable onPress={() => router.push("/owner/orders")} style={[styles.summaryAction, { backgroundColor: colors.brand }]}><Ionicons name="arrow-forward" size={20} color={colors.onBrand} /></Pressable>
              </Card>
              <View style={styles.grid}>
                {CARD_DEFS.map((c) => (
                  <View key={c.key} style={[styles.kpi, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                    <View style={[styles.kpiIcon, { backgroundColor: colors.brandSoft }]}>
                      <Ionicons name={c.icon} size={18} color={colors.onBrandSoft} />
                    </View>
                    <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onSurface }}>
                      {data.cards[c.key] ?? 0}
                      {c.unit ? <AppText style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.onSurfaceTertiary }}> {c.unit}</AppText> : null}
                    </AppText>
                    <AppText variant="caption">{c.label}</AppText>
                  </View>
                ))}
              </View>

              <WeeklyInsights />

              <View style={{ gap: spacing.sm }}>
                <View style={styles.rowBetween}>
                  <AppText variant="heading">Pending Approvals</AppText>
                  <Pressable onPress={() => router.push("/owner/orders")}>
                    <AppText variant="label" color={colors.brand}>All orders</AppText>
                  </Pressable>
                </View>
                {data.pending_orders.length === 0 ? (
                  <Card style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
                    <Ionicons name="checkmark-done-circle-outline" size={32} color={colors.success} />
                    <AppText variant="bodyMuted">No orders awaiting approval</AppText>
                  </Card>
                ) : (
                  <View style={{ gap: spacing.md }}>
                    {data.pending_orders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        onPress={() => router.push({ pathname: "/order/[id]", params: { id: order.id } })}
                      />
                    ))}
                  </View>
                )}
              </View>
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
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 112 },
  summaryIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  summaryAction: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kpi: { width: "48%", flexGrow: 1, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, gap: spacing.xs },
  kpiIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
