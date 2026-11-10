import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RoleModuleDirectory } from "@/src/components/RoleModuleDirectory";
import { OperationalHomeTopBar } from "@/src/components/OperationalHomeTopBar";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export default function DriverMore() {
  const { colors } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <OperationalHomeTopBar />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}>
        <AppText variant="title">More</AppText>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={[styles.avatar, { backgroundColor: colors.brand }]}><AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onBrand }}>{(user?.name || "D").charAt(0)}</AppText></View>
          <View style={{ flex: 1, gap: 4 }}><AppText variant="heading">{user?.name}</AppText><AppText variant="caption">{user?.phone}</AppText><Badge label="Driver" color={colors.brand} /></View>
        </Card>
        <RoleModuleDirectory role={user?.role} title="Driver Modules" />
        <Pressable testID="driver-permission-settings" accessibilityRole="button" onPress={() => router.push("/permission-settings")}
          style={[styles.manage, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.brand} />
          <View style={{ flex: 1 }}><AppText variant="heading">App permissions</AppText>
            <AppText variant="caption">Location, camera and Android notifications</AppText></View>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>
        <Pressable testID="driver-logout" onPress={async () => { await signOut(); router.replace("/login"); }} style={[styles.logout, { backgroundColor: colors.isDark ? "#96352D" : "#B42318" }]}><Ionicons name="log-out-outline" size={20} color="#FFFFFF" /><AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: "#FFFFFF" }}>Sign out</AppText></Pressable>
        <AppText variant="caption" center>TrackMyRMC · v2.0.18 (76)</AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },manage: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radius.md, }});
