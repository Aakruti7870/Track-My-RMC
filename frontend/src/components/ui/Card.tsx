import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";
import { GlassCardArtwork } from "./GlassCardArtwork";

type Variant = "default" | "elevated" | "muted" | "outline" | "brand";

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  variant?: Variant;
  testID?: string;
};

export function Card({ children, style, padded = true, variant = "default", testID }: Props) {
  const { colors } = useTheme();

  const visual = {
    default: {
      backgroundColor: colors.surfaceSecondary,
      borderColor: colors.isDark ? "rgba(255,154,61,0.28)" : "rgba(255,255,255,0.92)",
      shadowOpacity: colors.isDark ? 0.13 : 0.06,
      elevation: colors.isDark ? 2 : 1,
    },
    elevated: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.isDark ? "rgba(255,154,61,0.38)" : "rgba(255,255,255,0.96)",
      shadowOpacity: colors.isDark ? 0.19 : 0.11,
      elevation: 5,
    },
    muted: {
      backgroundColor: colors.surfaceTertiary,
      borderColor: colors.divider,
      shadowOpacity: 0,
      elevation: 0,
    },
    outline: {
      backgroundColor: colors.glassTint,
      borderColor: colors.borderStrong,
      shadowOpacity: 0,
      elevation: 0,
    },
    brand: {
      backgroundColor: colors.glassTint,
      borderColor: colors.isDark ? `${colors.brand}72` : `${colors.brand}3D`,
      shadowOpacity: 0,
      elevation: 0,
    },
  }[variant];

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        visual,
        {
          padding: padded ? spacing.lg : 0,
          shadowColor: colors.isDark ? "#FF9A3D" : colors.shadow,
        },
        style,
      ]}
    >
      {(variant === "default" || variant === "elevated") ? (
        <GlassCardArtwork cornerRadius={radius.lg} />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
  },
});
