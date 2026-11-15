import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { homeShortcutTile, iconTile, radius } from "@/src/theme/tokens";

type Artwork = { symbol: VectorSymbolName; icon?: never } | { symbol?: never; icon: keyof typeof Ionicons.glyphMap };

export function IconTile({ symbol, icon, size = 24, width = 44, height = width, homeShortcut = false }: Artwork & {
  size?: number;
  width?: number;
  height?: number;
  homeShortcut?: boolean;
}) {
  const { colors } = useTheme();
  const tone = colors.isDark ? homeShortcutTile.dark : homeShortcutTile.light;
  const backgroundColor = homeShortcut ? tone.background : colors.isDark ? iconTile.dark : iconTile.light;
  const foreground = homeShortcut ? tone.foreground : iconTile.foreground;

  return (
    <View style={[styles.tile, { width, height, backgroundColor }]}>
      {symbol
        ? <VectorSymbol name={symbol} size={size} color={foreground} outline={homeShortcut} />
        : <Ionicons name={icon} size={size} color={foreground} accessible={false} aria-hidden />}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.sm, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
