import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { Order } from "@/src/domain/order";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { AppText } from "./ui/AppText";

export type { Order as OrderData } from "@/src/domain/order";

type MetaProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
};

export function OrderCard({ order, onPress }: { order: Order; onPress?: () => void }) {
  const { colors } = useTheme();
  const interactive = Boolean(onPress);

  return (
    <Pressable
      onPress={onPress}
      disabled={!interactive}
      testID={`order-card-${order.order_number}`}
      accessibilityRole={interactive ? "button" : undefined}
      accessibilityLabel={`Order ${order.order_number}. ${order.grade}, ${order.quantity} cubic metres. ${order.status.replace(/_/g, " ")}.`}
      accessibilityHint={interactive ? "Opens order details" : undefined}
      style={({ pressed }) => [
        styles.pressable,
        { transform: [{ scale: pressed && interactive ? 0.992 : 1 }] },
      ]}
    >
      <Card variant="elevated" style={styles.card}>
        <View style={styles.headerRow}>
          <View style={[styles.orderGlyph, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "30" }]}>
            <Ionicons name="cube-outline" size={20} color={colors.brand} />
          </View>
          <View style={styles.headerText}>
            <AppText variant="eyebrow">RMC ORDER</AppText>
            <AppText
              numberOfLines={1}
              style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, lineHeight: 22, color: colors.onSurface }}
            >
              {order.order_number}
            </AppText>
            <AppText variant="caption" numberOfLines={1}>{order.plant_name}</AppText>
          </View>
          <View style={styles.headerStatus}>
            <Badge label={order.status.replace(/_/g, " ")} status={order.status} size="sm" />
            {interactive ? <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} /> : null}
          </View>
        </View>

        <View style={[styles.metaPanel, { backgroundColor: colors.surfaceTertiary, borderColor: colors.divider }]}>
          <Meta icon="layers-outline" label="GRADE" value={order.grade} colors={colors} />
          <View style={[styles.metaDivider, { backgroundColor: colors.divider }]} />
          <Meta icon="cube-outline" label="QUANTITY" value={`${order.quantity} m³`} colors={colors} />
          <View style={[styles.metaDivider, { backgroundColor: colors.divider }]} />
          <Meta
            icon="calendar-outline"
            label="DELIVERY"
            value={order.delivery_time ? `${order.delivery_date.slice(5)} · ${order.delivery_time}` : order.delivery_date.slice(5)}
            colors={colors}
          />
        </View>

        <View style={styles.footerRow}>
          <View style={[styles.siteIcon, { backgroundColor: colors.surfaceTertiary }]}>
            <Ionicons name="location-outline" size={16} color={colors.brand} />
          </View>
          <View style={styles.siteText}>
            <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.xs, color: colors.onSurfaceTertiary }}>DELIVERY SITE</AppText>
            <AppText variant="label" numberOfLines={1}>{order.site_name}</AppText>
          </View>
          <Badge label={order.payment_status} status={order.payment_status} size="sm" />
        </View>
      </Card>
    </Pressable>
  );
}

function Meta({ icon, label, value, colors }: MetaProps) {
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={15} color={colors.brand} />
      <AppText style={{ fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.45, color: colors.onSurfaceTertiary }} numberOfLines={1}>
        {label}
      </AppText>
      <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.onSurface }} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: radius.lg },
  card: { gap: spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  orderGlyph: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { minWidth: 0, flex: 1, gap: 1 },
  headerStatus: { alignItems: "flex-end", gap: spacing.sm },
  metaPanel: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  meta: {
    minWidth: 0,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 3,
  },
  metaDivider: { width: StyleSheet.hairlineWidth, marginVertical: 5 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  siteIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  siteText: { minWidth: 0, flex: 1, gap: 1 },
});
