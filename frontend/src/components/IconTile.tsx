import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { homeArtwork, lightQuickAccessArtwork, radius } from "@/src/theme/tokens";

type Artwork = { symbol: VectorSymbolName; icon?: never } | { symbol?: never; icon: keyof typeof Ionicons.glyphMap };

const horizontal = { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } };
const diagonal = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
const standardStops = [0, 0.5, 1] as const;

export function LightArtworkSurface({ children, style, cornerRadius = radius.sm, diagonalFill = false }: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  cornerRadius?: number;
  diagonalFill?: boolean;
}) {
  const artwork = lightQuickAccessArtwork;
  return (
    <View style={[styles.lightRim, { borderRadius: cornerRadius, backgroundColor: artwork.rim }, style]}>
      <LinearGradient {...horizontal} colors={artwork.copperEdge} locations={standardStops}
        style={[styles.lightEdge, { borderRadius: cornerRadius - 1 }]}>
        <LinearGradient {...(diagonalFill ? diagonal : horizontal)} colors={artwork.fill} locations={standardStops}
          style={[styles.lightFill, { borderRadius: cornerRadius - 2 }]}>
          <LinearGradient {...horizontal} colors={artwork.rightGlow} locations={[0.85, 0.97, 1]}
            pointerEvents="none" style={StyleSheet.absoluteFill} />
          {children}
        </LinearGradient>
      </LinearGradient>
    </View>
  );
}

export function IconTile({ symbol, icon, homeShortcut = false, bulk = false, diagonalFill = false, size = homeShortcut ? 28 : 24, width = homeShortcut ? 52 : 44, height = homeShortcut ? Math.min(width, 48) : width }: Artwork & {
  size?: number;
  width?: number;
  height?: number;
  homeShortcut?: boolean;
  bulk?: boolean;
  diagonalFill?: boolean;
}) {
  const { colors } = useTheme();
  const lightArtwork = !colors.isDark && (homeShortcut || bulk);
  const foreground = lightArtwork ? lightQuickAccessArtwork.iconInk
    : bulk ? "#FFFFFF" : homeShortcut ? homeArtwork.iconInk : colors.onSurfaceSecondary;
  const glyph = symbol
    ? <VectorSymbol name={symbol} size={size} color={foreground} />
    : <Ionicons name={icon} size={size} color={foreground} accessible={false} aria-hidden />;
  if (lightArtwork) {
    return <LightArtworkSurface style={{ width, height }} diagonalFill={diagonalFill}>{glyph}</LightArtworkSurface>;
  }
  if (homeShortcut && !bulk) {
    return (
      <LinearGradient {...horizontal} colors={homeArtwork.copperEdge}
        style={[styles.tile, { width, height, padding: 1 }]}>
        <LinearGradient {...(diagonalFill ? diagonal : horizontal)} colors={homeArtwork.quickFill} locations={standardStops} style={styles.inner}>
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
  lightRim: { padding: 1, flexShrink: 0 },
  lightEdge: { flex: 1, padding: 1 },
  lightFill: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  tile: { borderRadius: radius.sm, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
