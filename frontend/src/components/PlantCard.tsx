import React from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { Plant } from "@/src/domain/plant";
import { useTheme } from "@/src/theme/ThemeProvider";
import { control, fonts, fontSize, radius, spacing } from "@/src/theme/tokens";
import { formatDistanceKm } from "@/src/maps/geo";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { AppText } from "./ui/AppText";

export type { Plant as PlantData } from "@/src/domain/plant";

type ActionProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
  onPress: () => void;
  disabled?: boolean;
};

function readableStatus(value?: string) {
  const status = (value || "active").trim().toLowerCase();
  if (status === "active") return "Active";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PlantCard({ plant, onOrder }: { plant: Plant; onOrder?: () => void }) {
  const { colors } = useTheme();
  const status = (plant.status || "active").toLowerCase();
  const orderEnabled = plant.order_enabled ?? (status === "active" && plant.verified);
  const distance = formatDistanceKm(plant.distance_km);
  const hasPhone = Boolean(plant.contact_phone?.trim());

  const openDirections = () => {
    const destination = plant.lat != null && plant.lng != null ? `${plant.lat},${plant.lng}` : plant.address;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    void Linking.openURL(url);
  };

  return (
    <Card
      variant={plant.promoted ? "elevated" : "default"}
      style={[
        styles.card,
        plant.promoted ? { borderColor: colors.warning, shadowColor: colors.warning } : null,
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.plantGlyph, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "30" }]}>
          <Ionicons name="business-outline" size={22} color={colors.brand} />
        </View>
        <View style={styles.titleBlock}>
          <View style={styles.nameRow}>
            <AppText
              numberOfLines={2}
              style={{ flex: 1, fontFamily: fonts.bold, fontSize: fontSize.lg, lineHeight: 22, color: colors.onSurface }}
            >
              {plant.name}
            </AppText>
            {plant.verified ? <Ionicons name="shield-checkmark" size={19} color={colors.verified} accessibilityLabel="Verified plant" /> : null}
          </View>
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={colors.onSurfaceTertiary} />
            <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
              {plant.city}{plant.district ? ` · ${plant.district}` : ""}{distance ? ` · ${distance}` : ""}
            </AppText>
          </View>
        </View>
      </View>

      <View style={styles.badgeRow}>
        <Badge label={readableStatus(status)} status={status} size="sm" />
        {plant.verified ? <Badge label="KYC VERIFIED" status="KYC_VERIFIED" size="sm" /> : <Badge label="Verification pending" status="PENDING" size="sm" />}
        {plant.promoted ? (
          <View style={[styles.promotedBadge, { backgroundColor: colors.warning + "18", borderColor: colors.warning + "48" }]}>
            <Ionicons name="sparkles" size={13} color={colors.warning} />
            <AppText style={{ fontFamily: fonts.bold, fontSize: 10, color: colors.warning, letterSpacing: 0.5 }}>PROMOTED</AppText>
          </View>
        ) : null}
      </View>

      <View style={[styles.gradePanel, { backgroundColor: colors.surfaceTertiary, borderColor: colors.divider }]}>
        <View style={styles.gradeHeading}>
          <Ionicons name="layers-outline" size={15} color={colors.brand} />
          <AppText style={{ fontFamily: fonts.bold, fontSize: 10, color: colors.onSurfaceTertiary, letterSpacing: 0.5 }}>AVAILABLE GRADES</AppText>
        </View>
        <View style={styles.grades}>
          {plant.grades.slice(0, 5).map((grade) => (
            <View key={grade} style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary }}>{grade}</AppText>
            </View>
          ))}
          {plant.grades.length > 5 ? (
            <View style={[styles.gradeChip, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "30" }]}>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.brand }}>+{plant.grades.length - 5}</AppText>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Action icon="call-outline" label="Call" colors={colors} disabled={!hasPhone} onPress={() => hasPhone && void Linking.openURL(`tel:${plant.contact_phone}`)} />
        <Action icon="navigate-outline" label="Directions" colors={colors} onPress={openDirections} />
        <Pressable
          onPress={orderEnabled ? onOrder : undefined}
          disabled={!orderEnabled}
          testID={`plant-order-${plant.id}`}
          accessibilityRole="button"
          accessibilityLabel={orderEnabled ? `Order from ${plant.name}` : `${plant.name} ordering unavailable`}
          accessibilityState={{ disabled: !orderEnabled }}
          style={({ pressed }) => [
            styles.orderButton,
            {
              backgroundColor: orderEnabled ? (pressed ? colors.brandPressed : colors.brand) : colors.disabledSurface,
              borderColor: orderEnabled ? colors.brand : colors.border,
              transform: [{ scale: pressed && orderEnabled ? 0.985 : 1 }],
            },
          ]}
        >
          <Ionicons name={orderEnabled ? "add-circle-outline" : "time-outline"} size={17} color={orderEnabled ? colors.onBrand : colors.disabledContent} />
          <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: orderEnabled ? colors.onBrand : colors.disabledContent }}>
            {orderEnabled ? "Order RMC" : "Unavailable"}
          </AppText>
        </Pressable>
      </View>
    </Card>
  );
}

function Action({ icon, label, colors, onPress, disabled = false }: ActionProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: colors.border,
          backgroundColor: disabled ? colors.disabledSurface : pressed ? colors.surfaceTertiary : colors.surfaceSecondary,
          opacity: 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={disabled ? colors.disabledContent : colors.onSurfaceSecondary} />
      <AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm, color: disabled ? colors.disabledContent : colors.onSurfaceSecondary }}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  plantGlyph: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  titleBlock: { minWidth: 0, flex: 1, gap: 5 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  promotedBadge: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  gradePanel: { gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  gradeHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  grades: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  gradeChip: { minHeight: 30, justifyContent: "center", paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  action: { minHeight: control.minTouch, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  orderButton: { minHeight: control.minTouch, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, marginLeft: "auto" },
});
