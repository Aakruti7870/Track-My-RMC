import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { homeArtwork, radius } from "@/src/theme/tokens";

type Artwork = { symbol: VectorSymbolName; icon?: never } | { symbol?: never; icon: keyof typeof Ionicons.glyphMap };

export function IconTile({ symbol, icon, homeShortcut = false, bulk = false, size = homeShortcut ? 28 : 24, width = homeShortcut ? 52 : 44, height = homeShortcut ? Math.min(width, 48) : width }: Artwork & {
  size?: number;
  width?: number;
  height?: number;
  homeShortcut?: boolean;
  bulk?: boolean;
}) {
  const { colors } = useTheme();
  const foreground = bulk ? "#FFFFFF" : homeShortcut ? homeArtwork.iconInk : colors.onSurfaceSecondary;
  const glyph = symbol
    ? <VectorSymbol name={symbol} size={size} color={foreground} />
    : <Ionicons name={icon} size={size} color={foreground} accessible={false} aria-hidden />;
  if (homeShortcut && !bulk) {
    return (
      <LinearGradient colors={homeArtwork.copperEdge} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={[styles.tile, { width, height, padding: 1 }]}>
        <LinearGradient colors={homeArtwork.quickFill} locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.inner}>
          {glyph}
        </LinearGradient>
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
