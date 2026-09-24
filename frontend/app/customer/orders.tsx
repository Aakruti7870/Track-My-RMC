import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
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
  const [active, setActive] = useState("all");
  const { data, loading, error, refetch, reload } = useGet<{ orders: OrderData[] }>("/customer/orders");

  const filter = FILTERS.find((f) => f.key === active)!;
  const filtered = (data?.orders || []).filter((order) => filter.match(order.status.toUpperCase()));

  return (
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
          onRefresh={refetch}
          refreshing={false}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            <EmptyView
              icon="cube-outline"
              title="No orders here"
              subtitle={active === "all" ? "You haven't placed any orders yet" : "No orders in this status"}
            />
          }
        />
      )}
    </View>
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
