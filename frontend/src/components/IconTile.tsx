import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { homeArtwork, lightQuickAccessArtwork, radius } from "@/src/theme/tokens";

type Artwork = { symbol: VectorSymbolName; icon?: never } | { symbol?: never; icon: keyof typeof Ionicons.glyphMap };

const horizontal = { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } };
const standardStops = [0, 0.5, 1] as const;

export function IconTile({ symbol, icon, quickAccess = false, homeShortcut = quickAccess, bulk = false, size = homeShortcut ? 28 : 24, width = homeShortcut ? 52 : 44, height = homeShortcut ? Math.min(width, 48) : width }: Artwork & {
  size?: number;
  width?: number;
  height?: number;
  quickAccess?: boolean;
  homeShortcut?: boolean;
  bulk?: boolean;
}) {
  const { colors } = useTheme();
  const lightArtwork = quickAccess && !colors.isDark && !bulk ? lightQuickAccessArtwork : null;
  const shortcutInk = lightArtwork?.iconInk ?? homeArtwork.iconInk;
  const foreground = bulk ? "#FFFFFF" : homeShortcut ? shortcutInk : colors.onSurfaceSecondary;
  const glyph = symbol
    ? <VectorSymbol name={symbol} size={size} color={foreground} />
    : <Ionicons name={icon} size={size} color={foreground} accessible={false} aria-hidden />;
  if (lightArtwork) {
    return (
      <View style={[styles.tile, styles.lightRim, { width, height, backgroundColor: lightArtwork.rim }]}>
        <LinearGradient {...horizontal} colors={lightArtwork.copperEdge} locations={standardStops} style={styles.lightEdge}>
          <LinearGradient {...horizontal} colors={lightArtwork.fill} locations={standardStops} style={styles.lightFill}>
            <LinearGradient {...horizontal} colors={lightArtwork.rightGlow} locations={[0.85, 0.97, 1]}
              pointerEvents="none" style={StyleSheet.absoluteFill} />
            {glyph}
          </LinearGradient>
        </LinearGradient>
      </View>
    );
  }
  if (homeShortcut && !bulk) {
    return (
      <LinearGradient {...horizontal} colors={homeArtwork.copperEdge}
        style={[styles.tile, { width, height, padding: 1 }]}>
        <LinearGradient {...horizontal} colors={homeArtwork.quickFill} locations={standardStops} style={styles.inner}>
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
  lightRim: { padding: 1 },
  lightEdge: { flex: 1, width: "100%", padding: 1, borderRadius: radius.sm - 1 },
  lightFill: { flex: 1, borderRadius: radius.sm - 2, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  tile: { borderRadius: radius.sm, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
