import React from "react";
import { StyleSheet, Text, TextProps, TextStyle } from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize } from "@/src/theme/tokens";

type Variant =
  | "display"
  | "title"
  | "sectionTitle"
  | "heading"
  | "metric"
  | "body"
  | "bodyMuted"
  | "label"
  | "eyebrow"
  | "caption";

type Props = TextProps & {
  variant?: Variant;
  color?: string;
  center?: boolean;
  children: React.ReactNode;
};

export function AppText({ variant = "body", color, center, style, children, ...rest }: Props) {
  const { colors } = useTheme();

  const variants: Record<Variant, TextStyle> = {
    display: {
      fontFamily: fonts.displayBold,
      fontSize: fontSize["4xl"],
      lineHeight: 43,
      letterSpacing: -1.15,
      color: colors.onSurface,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSize["3xl"],
      lineHeight: 36,
      letterSpacing: -0.75,
      color: colors.onSurface,
    },
    sectionTitle: {
      fontFamily: fonts.display,
      fontSize: fontSize["2xl"],
      lineHeight: 30,
      letterSpacing: -0.35,
      color: colors.onSurface,
    },
    heading: {
      fontFamily: fonts.semibold,
      fontSize: fontSize.xl,
      lineHeight: 26,
      letterSpacing: -0.2,
      color: colors.onSurface,
    },
    metric: {
      fontFamily: fonts.displayBold,
      fontSize: fontSize["3xl"],
      lineHeight: 34,
      letterSpacing: -0.8,
      color: colors.onSurface,
      fontVariant: ["tabular-nums"],
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: fontSize.base,
      lineHeight: 22,
      color: colors.onSurface,
    },
    bodyMuted: {
      fontFamily: fonts.regular,
      fontSize: fontSize.base,
      lineHeight: 22,
      color: colors.onSurfaceTertiary,
    },
    label: {
      fontFamily: fonts.semibold,
      fontSize: fontSize.sm,
      lineHeight: 17,
      letterSpacing: 0.08,
      color: colors.onSurfaceSecondary,
    },
    eyebrow: {
      fontFamily: fonts.bold,
      fontSize: fontSize.xs,
      lineHeight: 15,
      letterSpacing: 1.1,
      textTransform: "uppercase",
      color: colors.brand,
    },
    caption: {
      fontFamily: fonts.regular,
      fontSize: fontSize.sm,
      lineHeight: 18,
      color: colors.onSurfaceTertiary,
    },
  };

  return (
    <Text
      {...rest}
      allowFontScaling
      maxFontSizeMultiplier={rest.maxFontSizeMultiplier ?? 1.6}
      style={[variants[variant], color ? { color } : null, center ? styles.center : null, style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({ center: { textAlign: "center" } });
