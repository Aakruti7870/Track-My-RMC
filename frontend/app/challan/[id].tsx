import React from "react";
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Challan = {
  id: string;
  challan_number: string;
  order_number: string;
  plant_name: string;
  customer_name: string;
  site_name: string;
  site_address: string;
  grade: string;
  quantity: number;
  tm_number: string;
  driver_name: string;
  driver_mobile: string;
  batcher?: string;
  supervisor?: string;
  quality_engineer?: string;
  remarks?: string;
  created_at?: string;
};

export default function ChallanScreen() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const base = user?.role === "plant_owner" ? "/owner/orders/" : "/customer/orders/";
  const { data, loading, error, reload } = useGet<{ challan: Challan }>(`${base}${id}/challan`);
  const c = data?.challan;

  const share = async () => {
    if (!c) return;
    const text =
      `DELIVERY CHALLAN ${c.challan_number}\n` +
      `Order: ${c.order_number}\nPlant: ${c.plant_name}\n` +
      `Customer: ${c.customer_name}\nSite: ${c.site_name}, ${c.site_address}\n` +
      `Grade: ${c.grade} · Qty: ${c.quantity} m³\n` +
      `TM: ${c.tm_number} · Driver: ${c.driver_name} (${c.driver_mobile})`;
    try {
      await Share.share({ message: text });
    } catch {
      toast("Could not open share sheet", "error");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="challan-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">Challan</AppText>
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : loading && !data ? (
        <View style={{ padding: spacing.lg }}>
          <Skeleton height={400} style={{ borderRadius: radius.lg }} />
        </View>
      ) : c ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {/* Challan header band */}
            <View style={[styles.band, { backgroundColor: colors.surfaceInverse }]}>
              <View>
                <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.lg, color: colors.onSurfaceInverse }}>TRACK MY RMC</AppText>
                <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceInverse, opacity: 0.7 }}>Delivery Challan</AppText>
              </View>
              <View style={[styles.chip, { backgroundColor: colors.brand }]}>
                <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.sm, color: colors.onBrand }}>{c.challan_number}</AppText>
              </View>
            </View>

            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <Field label="Order No." value={c.order_number} colors={colors} />
              <Field label="Plant" value={c.plant_name} colors={colors} />
              <Field label="Customer" value={c.customer_name} colors={colors} />
              <Field label="Delivery Site" value={`${c.site_name}, ${c.site_address}`} colors={colors} />
              <View style={styles.two}>
                <Field label="Grade" value={c.grade} colors={colors} half />
                <Field label="Quantity" value={`${c.quantity} m³`} colors={colors} half />
              </View>
              <View style={styles.two}>
                <Field label="Transit Mixer" value={c.tm_number} colors={colors} half />
                <Field label="Driver" value={c.driver_name} colors={colors} half />
              </View>
              <Field label="Driver Mobile" value={c.driver_mobile} colors={colors} />
              {c.batcher || c.supervisor || c.quality_engineer ? (
                <View style={styles.two}>
                  {c.batcher ? <Field label="Batcher" value={c.batcher} colors={colors} half /> : null}
                  {c.supervisor ? <Field label="Supervisor" value={c.supervisor} colors={colors} half /> : null}
                </View>
              ) : null}
              {c.quality_engineer ? <Field label="Quality Engineer" value={c.quality_engineer} colors={colors} /> : null}
              {c.remarks ? <Field label="Remarks" value={c.remarks} colors={colors} /> : null}
              {c.created_at ? (
                <AppText variant="caption" style={{ marginTop: spacing.sm }}>
                  Generated {new Date(c.created_at).toLocaleString()}
                </AppText>
              ) : null}
            </View>
          </Card>

          <Button testID="challan-share" label="Share Challan" onPress={share} icon={<Ionicons name="share-social-outline" size={18} color={colors.onBrand} />} />
        </ScrollView>
      ) : null}
    </View>
  );
}

function Field({ label, value, colors, half }: any) {
  return (
    <View style={{ gap: 2, flex: half ? 1 : undefined }}>
      <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>{label}</AppText>
      <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  band: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  two: { flexDirection: "row", gap: spacing.lg },
});
