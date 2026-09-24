import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Trip = { id: string; order_number: string; status: string; grade: string; quantity: number; tm_number: string; site_name: string };

const FILTERS = [
  { key: "active", label: "Active", match: (s: string) => !["DELIVERED", "DECLINED", "CANCELLED"].includes(s) },
  { key: "delivered", label: "Delivered", match: (s: string) => s === "DELIVERED" },
  { key: "all", label: "All", match: () => true },
];

export default function DriverTrips() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [active, setActive] = useState("active");
  const { data, loading, error, refetch, reload } = useGet<{ trips: Trip[] }>("/driver/trips");
  const filter = FILTERS.find((f) => f.key === active)!;
  const filtered = (data?.trips || []).filter((trip) => filter.match(trip.status.toUpperCase()));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={{ borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }}>
        <View style={styles.titleRow}><AppText variant="title">My Trips</AppText></View>
        <View style={styles.chipRow}>
          {FILTERS.map((f) => {
            const sel = f.key === active;
            return (
              <Pressable key={f.key} testID={`trip-filter-${f.key}`} onPress={() => setActive(f.key)} style={[styles.chip, { backgroundColor: sel ? colors.brand : colors.surfaceSecondary, borderColor: sel ? colors.brand : colors.border }]}>
                <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, color: sel ? colors.onBrand : colors.onSurfaceSecondary }}>{f.label}</AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : loading && !data ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>{[0, 1].map((i) => <Skeleton key={i} height={120} style={{ borderRadius: radius.lg }} />)}</View>
      ) : (
        <FlatList
          testID="driver-trips-list"
          data={filtered}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={false}
          renderItem={({ item }) => (
            <Pressable
              testID={`trip-card-${item.order_number}`}
              onPress={() => router.push({ pathname: "/trip/[id]", params: { id: item.id } })}
            >
              <Card style={{ gap: spacing.sm }}>
                <View style={styles.rowBetween}>
                  <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.onSurface }}>{item.order_number}</AppText>
                  <Badge label={item.status.replace(/_/g, " ")} status={item.status} />
                </View>
                <AppText variant="caption">{item.grade} · {item.quantity} m³ · {item.tm_number}</AppText>
                <View style={styles.siteRow}>
                  <Ionicons name="location-outline" size={14} color={colors.onSurfaceTertiary} />
                  <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>{item.site_name}</AppText>
                </View>
              </Card>
            </Pressable>
          )}
          ListEmptyComponent={<EmptyView icon="navigate-outline" title="No trips" subtitle="Assigned trips will appear here" />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  chipRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  siteRow: { flexDirection: "row", alignItems: "center", gap: 4 },
});
