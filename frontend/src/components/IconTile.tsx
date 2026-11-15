import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { homeArtwork, radius } from "@/src/theme/tokens";

type Artwork = { symbol: VectorSymbolName; icon?: never } | { symbol?: never; icon: keyof typeof Ionicons.glyphMap };

export function IconTile({ symbol, icon, size = 24, width = 44, height = width, homeShortcut = false, bulk = false }: Artwork & {
  size?: number;
  width?: number;
  height?: number;
  homeShortcut?: boolean;
  bulk?: boolean;
}) {
  const { colors } = useTheme();
  const foreground = bulk ? "#FFFFFF" : homeShortcut ? colors.isDark ? "#FFF0E2" : "#D88A38" : colors.onSurfaceSecondary;
  const glyph = symbol
    ? <VectorSymbol name={symbol} size={size} color={foreground} outline={homeShortcut || bulk}
        outlineBackdrop={homeShortcut && !colors.isDark ? "#633507" : undefined} />
    : <Ionicons name={icon} size={size} color={homeShortcut && !colors.isDark ? "#633507" : foreground} accessible={false} aria-hidden />;
  if (homeShortcut && !bulk) {
    return (
      <LinearGradient colors={homeArtwork.copperEdge} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={[styles.tile, { width, height, padding: 1 }]}>
        <View style={[styles.inner, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={[StyleSheet.absoluteFill, styles.inner, { backgroundColor: homeArtwork.quickFill }]} />
          {glyph}
        </View>
      </LinearGradient>
    );
  }
  return (
    <View style={[styles.tile, { width, height,
      backgroundColor: bulk ? homeArtwork.bulkIconFill : colors.surfaceTertiary,
      borderColor: bulk ? "transparent" : colors.divider,
      borderWidth: 1,
    }]}>{glyph}</View>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, width: "100%", borderRadius: radius.sm - 1, alignItems: "center", justifyContent: "center" },
  tile: { borderRadius: radius.sm, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
