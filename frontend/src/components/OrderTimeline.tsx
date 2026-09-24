import React from "react";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, spacing, statusColor } from "@/src/theme/tokens";
import { AppText } from "./ui/AppText";

export type HistoryEntry = { from: string | null; to: string; note?: string | null; at?: string | null };

function fmt(at?: string | null) {
  if (!at) return "";
  try {
    const d = new Date(at);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function OrderTimeline({ history }: { history: HistoryEntry[] }) {
  const { colors } = useTheme();
  const items = [...history].reverse(); // newest first

  return (
    <View style={{ gap: 0 }}>
      {items.map((h, i) => {
        const c = statusColor(colors, h.to);
        const last = i === items.length - 1;
        return (
          <View key={i} style={styles.row}>
            <View style={styles.railCol}>
              <View style={[styles.node, { backgroundColor: c, borderColor: colors.surface }]} />
              {!last ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : spacing.lg }}>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>
                {h.to.replace(/_/g, " ")}
              </AppText>
              {h.note ? <AppText variant="caption">{h.note}</AppText> : null}
              <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>
                {fmt(h.at)}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md },
  railCol: { alignItems: "center", width: 16 },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginTop: 2 },
  line: { width: 2, flex: 1, marginTop: 2 },
});
