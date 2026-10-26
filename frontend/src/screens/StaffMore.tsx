import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { StaffModuleDirectory } from "@/src/screens/StaffModuleDirectory";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const MODES: { key: "system" | "light" | "dark"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
  { key: "system", label: "System", icon: "phone-portrait-outline" },
];

export function StaffMore() {
  const { colors, mode, setMode } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const doLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "transparent" }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><VectorSymbol name="settings" size={35} /><AppText variant="title">More</AppText></View>

        <Card variant="elevated" style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={[styles.avatar, { backgroundColor: colors.brand }]}>
            <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onBrand }}>
              {(user?.name || "U").charAt(0).toUpperCase()}
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="heading" numberOfLines={1}>{user?.name}</AppText>
            <AppText variant="caption">{user?.email || user?.phone}</AppText>
            <View style={{ flexDirection: "row", gap: spacing.xs }}><Badge label={user?.role_label || "Staff"} color={colors.brand} /></View>
          </View>
        </Card>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Appearance</AppText>
          <View style={styles.modeRow}>
            {MODES.map((m) => {
              const selected = mode === m.key;
              return (
                <Pressable key={m.key} testID={`theme-mode-${m.key}`} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={m.label + " theme"} onPress={() => setMode(m.key)} style={[styles.mode, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}>
                  <Ionicons name={m.icon} size={18} color={selected ? colors.onBrand : colors.onSurfaceSecondary} />
                  <AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm, color: selected ? colors.onBrand : colors.onSurfaceSecondary }}>{m.label}</AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {user?.role === "admin" && <Pressable testID="plant-manager-design-challan" accessibilityRole="button" accessibilityLabel="Design Challan" onPress={() => router.push("/challan-design")}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <VectorSymbol name="delivery-challan" size={45} />
            <View style={{ flex: 1, gap: 3 }}>
              <AppText variant="heading">Design Challan</AppText>
              <AppText variant="caption">Plant-specific A4 · logo · save and print</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary}/>
          </Card>
        </Pressable>}
        <StaffModuleDirectory role={user?.role} title="Role workspace" searchable />

        <Pressable testID="logout-button" accessibilityRole="button" accessibilityLabel="Sign out of staff account" onPress={doLogout} style={[styles.logout, { borderColor: colors.error }]}><VectorSymbol name="logout" size={27} /><AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.error }}>Logout</AppText></Pressable>
        <AppText variant="caption" center>TrackMyRMC · v2.0.18 (76)</AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  modeRow: { flexDirection: "row", gap: spacing.sm },
  mode: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, height: 44, borderRadius: radius.md, borderWidth: 1 },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radius.md, borderWidth: 1 },
  manage: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
});
