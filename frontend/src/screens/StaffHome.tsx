import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { StaffCollection } from "@/src/screens/StaffCollection";
import { RoleModuleDirectory } from "@/src/components/RoleModuleDirectory";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Kpi = { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; unit?: string | null };
type HomeData = {
  role: string;
  role_label: string;
  name: string;
  kpis: Kpi[];
  primary: { title: string; kind: string };
};
function formatValue(k: Kpi): string {
  if (k.unit === "₹") return `₹${Number(k.value).toLocaleString("en-IN")}`;
  return `${k.value}`;
}

export function StaffHome() {
  const { colors, toggle, scheme } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/staff/home");
  const { data: notif } = useGet<{ unread: number }>("/notifications");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <AppText variant="caption">{data?.role_label || user?.role_label}</AppText>
          <AppText variant="title" numberOfLines={1}>{data?.name || user?.name}</AppText>
        </View>
        <Pressable testID="staff-notif" onPress={() => router.push("/notifications")} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="notifications-outline" size={20} color={colors.onSurface} />
          {notif && notif.unread > 0 ? <View style={[styles.badge, { backgroundColor: colors.brand }]} /> : null}
        </Pressable>
        <Pressable testID="staff-theme-toggle" onPress={toggle} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name={scheme === "dark" ? "sunny-outline" : "moon-outline"} size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {error && !data ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}><ErrorView message={error} onRetry={reload} /><RoleModuleDirectory role={user?.role} /></ScrollView>
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
              <View style={[styles.summary, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "3D" }]} testID="staff-home-summary">
                <View style={[styles.summaryIcon, { backgroundColor: colors.brand }]}><Ionicons name="pulse" size={21} color={colors.onBrand} /></View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <AppText variant="caption">LIVE WORKSPACE</AppText>
                  <AppText style={styles.summaryTitle} numberOfLines={1}>{data.primary.title}</AppText>
                  <AppText variant="bodyMuted">Current operational queue from your plant</AppText>
                </View>
                <Ionicons name="chevron-down" size={20} color={colors.onBrandSoft} />
              </View>
              <View style={styles.grid}>
                {data.kpis.map((c) => (
                  <View key={c.label} style={[styles.kpi, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                    <View style={[styles.kpiIcon, { backgroundColor: colors.brandSoft }]}>
                      <Ionicons name={c.icon} size={18} color={colors.onBrandSoft} />
                    </View>
                    <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onSurface }} numberOfLines={1}>
                      {formatValue(c)}
                      {c.unit && c.unit !== "₹" ? <AppText style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.onSurfaceTertiary }}> {c.unit}</AppText> : null}
                    </AppText>
                    <AppText variant="caption">{c.label}</AppText>
                  </View>
                ))}
              </View>

              <View style={{ gap: spacing.sm }}>
                <AppText variant="heading">{data.primary.title}</AppText>
                <StaffCollection kind={data.primary.kind} embedded limit={6} />
              </View>
              <RoleModuleDirectory role={user?.role} />
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
  badge: { position: "absolute", top: 8, right: 8, width: 9, height: 9, borderRadius: 5 },
  summary: { minHeight: 108, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  summaryIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kpi: { width: "48%", flexGrow: 1, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, gap: spacing.xs },
  kpiIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  moduleGrid: { gap: spacing.sm },
  module: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
