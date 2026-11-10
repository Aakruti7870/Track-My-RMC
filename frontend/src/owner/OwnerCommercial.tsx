import React from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { fonts } from "@/src/theme/tokens";
import { ownerDestination, ownerModules, HOME_COMMERCIAL_KEYS } from "./modules";
import { OwnerGlass, useOwnerPalette } from "./OwnerUI";

/**
 * Exactly 12 tiles, covering all 13 explicitly requested destinations:
 * Payroll and Payroll Closure share one tile with separate actions.
 * Never duplicate these destinations in Owner More or Operations.
 */
export function OwnerCommercial() {
  const p = useOwnerPalette();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const contentWidth = Math.max(0, Math.min(width, 820) - 32);
  const columns = contentWidth >= 750 ? 6 : contentWidth >= 580 ? 4 : contentWidth >= 440 ? 3 : 2;
  const tileWidth = (contentWidth - (columns - 1) * 8) / columns;
  const modules = ownerModules(HOME_COMMERCIAL_KEYS);
  const closure = modules.find(module => module.key === "payroll-closure");
  const tiles = modules.filter(module => module.key !== "payroll-closure");

  return <View testID="owner-commercial-grid" style={styles.grid}>
    {tiles.map(module => module.key === "business-payroll" ? (
      <OwnerGlass key={module.key} style={[styles.tile, { width: tileWidth }]}>
        <Pressable testID="role-module-business-payroll" accessibilityRole="button"
          accessibilityLabel="Payroll records" onPress={() => router.push(ownerDestination(module))}
          style={styles.payrollMain}>
          {module.symbol ? <VectorSymbol name={module.symbol} size={32} warmAccent /> : <Ionicons name={module.icon} size={29} color={p.accent} />}
          <AppText center numberOfLines={2} style={[styles.label, { color: p.text }]}>Payroll</AppText>
          <AppText center numberOfLines={2} style={[styles.copy, { color: p.muted }]}>Payroll records.</AppText>
        </Pressable>
        {closure ? <Pressable testID="role-module-payroll-closure" accessibilityRole="button"
          accessibilityLabel="Payroll Closure and Payslips" onPress={() => router.push(closure.route)}
          style={[styles.closure, { borderTopColor: p.border }]}>
          <AppText center numberOfLines={2} style={[styles.closureLabel, { color: p.dark ? "#FFBD8A" : "#A64B0E" }]}>Closure & Payslips</AppText>
        </Pressable> : null}
      </OwnerGlass>
    ) : (
      <Pressable key={module.key} testID={`role-module-${module.key}`}
        accessibilityRole="button" accessibilityLabel={module.label} accessibilityHint={module.description}
        onPress={() => router.push(ownerDestination(module))}
        style={({ pressed }) => ({ width: tileWidth, opacity: pressed ? 0.75 : 1 })}>
        <OwnerGlass style={styles.tile}>
          {module.symbol ? <VectorSymbol name={module.symbol} size={32} warmAccent /> : <Ionicons name={module.icon} size={29} color={p.accent} />}
          <AppText center numberOfLines={2} style={[styles.label, { color: p.text }]}>{module.label}</AppText>
          <AppText center numberOfLines={2} style={[styles.copy, { color: p.muted }]}>{module.description}</AppText>
        </OwnerGlass>
      </Pressable>
    ))}
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { minHeight: 118, width: "100%", paddingHorizontal: 6, paddingVertical: 8, alignItems: "center", justifyContent: "center", gap: 3 },
  label: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
  copy: { fontSize: 9, lineHeight: 12 },
  payrollMain: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, width: "100%" },
  closure: { width: "100%", minHeight: 27, borderTopWidth: 1, justifyContent: "center", paddingTop: 3 },
  closureLabel: { fontFamily: fonts.semibold, fontSize: 9, lineHeight: 12 },
});
