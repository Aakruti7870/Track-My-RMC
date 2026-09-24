import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const MODES: { key: "system" | "light" | "dark"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
  { key: "system", label: "System", icon: "phone-portrait-outline" },
];

export default function DriverMore() {
  const { colors, mode, setMode } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}>
        <AppText variant="title">More</AppText>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={[styles.avatar, { backgroundColor: colors.brand }]}><AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onBrand }}>{(user?.name || "D").charAt(0)}</AppText></View>
          <View style={{ flex: 1, gap: 4 }}><AppText variant="heading">{user?.name}</AppText><AppText variant="caption">{user?.phone}</AppText><Badge label="Driver" color={colors.brand} /></View>
        </Card>
        <View style={{ gap: spacing.sm }}><AppText variant="label">Appearance</AppText><View style={{ flexDirection: "row", gap: spacing.sm }}>{MODES.map((m) => { const sel = mode === m.key; return <Pressable key={m.key} testID={`driver-theme-${m.key}`} onPress={() => setMode(m.key)} style={[styles.mode, { backgroundColor: sel ? colors.brand : colors.surfaceSecondary, borderColor: sel ? colors.brand : colors.border }]}><Ionicons name={m.icon} size={18} color={sel ? colors.onBrand : colors.onSurfaceSecondary} /><AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm, color: sel ? colors.onBrand : colors.onSurfaceSecondary }}>{m.label}</AppText></Pressable>; })}</View></View>
        <Pressable testID="driver-workforce-hub" onPress={() => router.push("/workforce")} style={[styles.manage, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}><Ionicons name="people-circle-outline" size={22} color={colors.brand} /><View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>Workforce &amp; Field Activity</AppText><AppText variant="caption">Attendance, leave, visits and expense claims</AppText></View><Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} /></Pressable>
        <Pressable testID="driver-shift-roster" onPress={() => router.push("/shift-roster")} style={[styles.manage, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}><Ionicons name="calendar-outline" size={22} color={colors.brand} /><View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>My Shift &amp; Roster</AppText><AppText variant="caption">Upcoming shifts, week-offs and attendance geofence</AppText></View><Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} /></Pressable>
        <Pressable testID="driver-my-payslip" onPress={() => router.push("/my-payslip")} style={[styles.manage, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}><Ionicons name="document-text-outline" size={22} color={colors.brand} /><View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>My Payslip</AppText><AppText variant="caption">View and share closed-month payroll payslips</AppText></View><Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} /></Pressable>
        <Pressable testID="driver-logout" onPress={async () => { await signOut(); router.replace("/login"); }} style={[styles.logout, { borderColor: colors.error }]}><Ionicons name="log-out-outline" size={20} color={colors.error} /><AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.error }}>Logout</AppText></Pressable>
        <AppText variant="caption" center>TrackMyRMC · v2.0.18 (76)</AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },mode: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, height: 44, borderRadius: radius.md, borderWidth: 1 },manage: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radius.md, borderWidth: 1 }});
