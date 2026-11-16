import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";

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
      borderColor: colors.divider,
      shadowOpacity: 0,
      elevation: 0,
    },
    elevated: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.divider,
      shadowOpacity: colors.isDark ? 0 : 0.08,
      elevation: colors.isDark ? 0 : 2,
    },
    muted: {
      backgroundColor: colors.surfaceTertiary,
      borderColor: colors.divider,
      shadowOpacity: 0,
      elevation: 0,
    },
    outline: {
      backgroundColor: colors.surfaceSecondary,
      borderColor: colors.borderStrong,
      shadowOpacity: 0,
      elevation: 0,
    },
    brand: {
      backgroundColor: colors.surfaceSecondary,
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
          shadowColor: colors.shadow,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
  },
});
