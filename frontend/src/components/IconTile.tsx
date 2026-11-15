import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { iconTile, radius } from "@/src/theme/tokens";

type Artwork = { symbol: VectorSymbolName; icon?: never } | { symbol?: never; icon: keyof typeof Ionicons.glyphMap };

export function IconTile({ symbol, icon, size = 24, width = 44, height = width }: Artwork & {
  size?: number;
  width?: number;
  height?: number;
}) {
  const { colors } = useTheme();

  return (
    <View style={[styles.tile, { width, height, backgroundColor: colors.isDark ? iconTile.dark : iconTile.light }]}>
      {symbol
        ? <VectorSymbol name={symbol} size={size} color={iconTile.foreground} />
        : <Ionicons name={icon} size={size} color={iconTile.foreground} accessible={false} aria-hidden />}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.sm, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
