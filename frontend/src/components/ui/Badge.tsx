import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { orderStatusColor } from "@/src/domain/order";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing, statusColor } from "@/src/theme/tokens";

type Props = {
  label: string;
  status?: string;
  color?: string;
  orderStatus?: boolean;
  solid?: boolean;
  size?: "sm" | "md";
  testID?: string;
};

function alpha(hex: string, suffix: string, fallback: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? `${hex}${suffix}` : fallback;
}

export function Badge({ label, status, color, orderStatus = false, solid = false, size = "md", testID }: Props) {
  const { colors } = useTheme();
  const normalizedStatus = (status || label).toUpperCase();
  const isVerified = normalizedStatus === "VERIFIED" || normalizedStatus === "KYC VERIFIED" || normalizedStatus === "KYC_VERIFIED";
  const c = color ?? (orderStatus ? orderStatusColor(normalizedStatus, colors.isDark) : undefined) ?? statusColor(colors, normalizedStatus);
  const background = isVerified
    ? colors.verifiedSoft
    : alpha(c, "14", colors.surfaceTertiary);
  const border = alpha(c, "38", colors.border);

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.badge,
        size === "sm" ? styles.small : null,
        solid
          ? { backgroundColor: c, borderColor: c }
          : { backgroundColor: background, borderColor: border },
      ]}
    >
      <View style={[styles.dot, size === "sm" ? styles.smallDot : null, { backgroundColor: solid ? "#FFFFFF" : c }]} />
      <Text
        numberOfLines={2}
        style={[
          styles.text,
          size === "sm" ? styles.smallText : null,
          { color: solid ? "#FFFFFF" : c },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 0,
    maxWidth: "100%",
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  small: {
    minHeight: 24,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  smallDot: { width: 5, height: 5, borderRadius: 2.5 },
  text: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
    lineHeight: 16,
    letterSpacing: 0.05,
  },
  smallText: { fontSize: fontSize.xs, lineHeight: 14 },
});
