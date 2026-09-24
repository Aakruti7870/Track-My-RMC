import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Insights = {
  labels: string[];
  ordered: number[];
  delivered: number[];
  payments: number[];
  totals: { ordered: number; delivered: number; payments: number };
};

const CHART_H = 96;

/** Weekly volume ordered vs delivered + payments received — for plant owners. */
export function WeeklyInsights() {
  const { colors } = useTheme();
  const { data, loading } = useGet<Insights>("/owner/insights");

  if (loading && !data) return <Skeleton height={230} style={{ borderRadius: radius.lg }} />;
  if (!data) return null;

  const maxVol = Math.max(1, ...data.ordered, ...data.delivered);
  const maxPay = Math.max(1, ...data.payments);

  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="heading">This Week</AppText>
      <Card style={{ gap: spacing.md }}>
        <View style={styles.totals}>
          <Total label="Ordered" value={`${data.totals.ordered} m³`} color={colors.brand} />
          <Total label="Delivered" value={`${data.totals.delivered} m³`} color={colors.success} />
          <Total label="Received" value={`₹${Number(data.totals.payments).toLocaleString("en-IN")}`} color={colors.onSurface} />
        </View>

        <View style={styles.chart}>
          {data.labels.map((lbl, i) => (
            <View key={lbl + i} style={styles.col}>
              <View style={styles.bars}>
                <View style={[styles.bar, { height: Math.max(3, (data.ordered[i] / maxVol) * CHART_H), backgroundColor: colors.brand }]} />
                <View style={[styles.bar, { height: Math.max(3, (data.delivered[i] / maxVol) * CHART_H), backgroundColor: colors.success }]} />
              </View>
              <AppText style={{ fontFamily: fonts.medium, fontSize: 10, color: colors.onSurfaceTertiary }}>{lbl}</AppText>
            </View>
          ))}
        </View>

        <View style={styles.legend}>
          <Dot color={colors.brand} label="Ordered" textColor={colors.onSurfaceSecondary} />
          <Dot color={colors.success} label="Delivered" textColor={colors.onSurfaceSecondary} />
        </View>

        <View style={{ gap: 4 }}>
          <View style={styles.rowBetween}>
            <AppText variant="label">Payments received</AppText>
            <Ionicons name="cash-outline" size={16} color={colors.onSurfaceTertiary} />
          </View>
          <View style={styles.payRow}>
            {data.payments.map((p, i) => (
              <View key={i} style={styles.payCol}>
                <View style={[styles.payBar, { height: Math.max(2, (p / maxPay) * 40), backgroundColor: colors.brandSoft }]} />
              </View>
            ))}
          </View>
        </View>
      </Card>
    </View>
  );
}

function Total({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.lg, color }}>{value}</AppText>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

function Dot({ color, label, textColor }: { color: string; label: string; textColor: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <AppText style={{ fontFamily: fonts.medium, fontSize: 12, color: textColor }}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: "row", gap: spacing.sm },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: CHART_H + 20 },
  col: { flex: 1, alignItems: "center", gap: 6 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: CHART_H },
  bar: { width: 9, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  legend: { flexDirection: "row", gap: spacing.lg, justifyContent: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  payRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 44 },
  payCol: { flex: 1, alignItems: "center" },
  payBar: { width: "80%", borderRadius: 3 },
});
