import React, { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useAuth } from "@/src/auth/AuthContext";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { OrderCard, OrderData } from "@/src/components/OrderCard";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { fonts, radius, spacing } from "@/src/theme/tokens";

const FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "pending", label: "Pending", match: (s) => ["PENDING", "DRAFT"].includes(s) },
  { key: "accepted", label: "Accepted", match: (s) => ["ACCEPTED", "SCHEDULED"].includes(s) },
  { key: "production", label: "In Production", match: (s) => ["IN_PRODUCTION", "PRODUCTION_COMPLETE"].includes(s) },
  { key: "dispatched", label: "Dispatched", match: (s) => ["DISPATCHED", "EN_ROUTE", "AT_SITE", "UNLOADING", "POD_PENDING", "TM_ASSIGNED", "DRIVER_ASSIGNED", "READY_TO_DISPATCH"].includes(s) },
  { key: "delivered", label: "Delivered", match: (s) => s === "DELIVERED" },
  { key: "cancelled", label: "Cancelled", match: (s) => ["CANCELLED", "REJECTED"].includes(s) },
];

export default function CustomerOrders() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [active, setActive] = useState("all");
  const { data, loading, error, refetch, reload } = useGet<{ orders: OrderData[] }>("/customer/orders");
  const drafts = useGet<{ drafts: { id: string; form: { site_name: string; grade: string | null; quantity: string }; provisional_status?: string | null; provisional_order_id?: string | null; plant_response?: string | null }[] }>("/customer/order-drafts");
  useFocusEffect(useCallback(() => { void refetch(); void drafts.refetch(); }, [refetch, drafts.refetch]));

  const filter = FILTERS.find((f) => f.key === active)!;
  const filtered = (data?.orders || []).filter((order) => filter.match(order.status.toUpperCase()));
  const visibleDrafts = active === "all" || active === "pending" ? drafts.data?.drafts || [] : [];

  return (
    <ThemedScreen>
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      {/* Sticky header + chip row */}
      <View style={{ borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }}>
        <View style={styles.titleRow}>
          <AppText variant="title">My Orders</AppText>
        </View>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(i) => i.key}
          style={styles.chipRow}
          contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" }}
          renderItem={({ item }) => {
            const selected = item.key === active;
            return (
              <Pressable
                testID={`filter-${item.key}`}
                onPress={() => setActive(item.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.brand : colors.surfaceSecondary,
                    borderColor: selected ? colors.brand : colors.border,
                  },
                ]}
              >
                <AppText
                  style={{
                    fontFamily: fonts.semibold,
                    fontSize: 13,
                    color: selected ? colors.onBrand : colors.onSurfaceSecondary,
                  }}
                >
                  {item.label}
                </AppText>
              </Pressable>
            );
          }}
        />
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : loading && !data ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={150} style={{ borderRadius: radius.lg }} />
          ))}
        </View>
      ) : (
        <FlatList
          testID="orders-list"
          data={filtered}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onRefresh={() => { void refetch(); void drafts.refetch(); }}
          refreshing={false}
          ListHeaderComponent={visibleDrafts.length || drafts.error ? <View style={{ gap: spacing.sm }}>
            <AppText variant="heading">Saved Drafts</AppText>
            {drafts.error ? <AppText variant="caption">Could not load saved drafts. Pull to refresh.</AppText> : null}
            {visibleDrafts.map((draft) => <Pressable key={draft.id} accessibilityRole="button"
              onPress={() => draft.provisional_status === "CONVERTED" && draft.provisional_order_id
                ? router.push({ pathname: "/order/[id]", params: { id: draft.provisional_order_id } })
                : router.push({ pathname: "/new-order", params: { draftId: draft.id } })}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, padding: spacing.md, gap: spacing.xs }}>
              <AppText variant="heading">{draft.form.site_name || "Untitled order draft"}</AppText>
              <AppText variant="caption">{draft.provisional_status === "PENDING_KYC" ? (user?.kyc_status?.toUpperCase() === "VERIFIED" ? "AWAITING CUSTOMER CONFIRMATION" : "PROVISIONAL · PENDING KYC") : draft.provisional_status === "CONVERTED" ? "ORDER SUBMITTED" : draft.provisional_status || "DRAFT"} · {draft.form.grade || "Grade not selected"} · {draft.form.quantity || "Quantity not set"} m³</AppText>
              {draft.plant_response ? <AppText variant="caption">Plant response: {draft.plant_response}</AppText> : null}
              <AppText variant="caption" color={colors.brand}>Review details</AppText>
            </Pressable>)}
          </View> : null}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            visibleDrafts.length ? null : <EmptyView
              icon="cube-outline"
              title="No orders here"
              subtitle={active === "all" ? "You haven't placed any orders yet" : "No orders in this status"}
            />
          }
        />
      )}
    </View>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  chipRow: { maxHeight: 56, marginBottom: spacing.sm },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
