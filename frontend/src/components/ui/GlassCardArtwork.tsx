import React from "react";
import { Image, StyleSheet } from "react-native";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius } from "@/src/theme/tokens";

/**
 * One cached theme asset per card, behind interactive content.
 * Shared by default/elevated cards and navigation tiles on Android and Web.
 * Native Image supports both uploaded WebP files directly; SVGs remain
 * scalable design masters and aren't imported as Metro React components.
 */
export function GlassCardArtwork({
  cornerRadius = radius.lg,
  opacity = 0.90,
}: {
  cornerRadius?: number;
  opacity?: number;
}) {
  const { colors } = useTheme();
  return (
    <Image
      pointerEvents="none"
      accessible={false}
      source={colors.isDark
        ? require("../../../assets/images/trackmyrmc-dark-glass-card.webp")
        : require("../../../assets/images/trackmyrmc-glass-card-light.webp")}
      resizeMode="stretch"
      fadeDuration={0}
      style={[StyleSheet.absoluteFillObject, { borderRadius: cornerRadius, opacity }]}
    />
  );
}
