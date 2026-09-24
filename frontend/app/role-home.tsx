import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { ROLE_LABELS } from "@/src/constants/roles";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

// The exact bottom-nav blueprint for every non-customer role (from the spec).
const NAV_BLUEPRINT: Record<string, string[]> = {
  driver: ["Home", "Trips", "Attendance", "More"],
  plant_owner: ["Home", "Orders", "Operations", "More"],
  admin: ["Home", "Orders", "Operations", "More"],
  dispatcher: ["Home", "Dispatch", "Fleet", "More"],
  operator: ["Home", "Production", "Batches", "More"],
  supervisor: ["Home", "Operations", "Incidents", "More"],
  accountant: ["Home", "Billing", "Ledger", "More"],
  quality_engineer: ["Home", "Quality", "Mix Design", "More"],
  fleet_manager: ["Home", "Fleet", "Drivers", "More"],
  store_manager: ["Home", "Stock", "Purchase", "More"],
};

export default function RoleHome() {
  const { colors, scheme } = useTheme();
  const { hydrating, token, user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  if (user.role === "customer") return <Redirect href="/customer" />;

  const tabs = NAV_BLUEPRINT[user.role] || ["Home", "More"];

  const doLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <View style={[styles.logo, { backgroundColor: colors.brand }]}>
            <Ionicons name="cube" size={20} color={colors.onBrand} />
          </View>
          <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onSurface }}>
            TRACK MY RMC
          </AppText>
        </View>

        <Card style={{ gap: spacing.sm }}>
          <AppText variant="caption">Signed in as</AppText>
          <AppText variant="title">{user.name}</AppText>
          <View style={[styles.rolePill, { backgroundColor: colors.brandSoft }]}>
            <Ionicons name="ribbon-outline" size={16} color={colors.onBrandSoft} />
            <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.sm, color: colors.onBrandSoft }}>
              {ROLE_LABELS[user.role] || user.role}
            </AppText>
          </View>
        </Card>

        <Card style={{ gap: spacing.md, alignItems: "center", paddingVertical: spacing.xl }}>
          <View style={[styles.iconBubble, { backgroundColor: colors.surfaceTertiary }]}>
            <Ionicons name="construct-outline" size={30} color={colors.brand} />
          </View>
          <AppText variant="heading" center>Your dashboard is on the way</AppText>
          <AppText variant="bodyMuted" center>
            Authentication & role routing are live. The full {ROLE_LABELS[user.role]} workspace ships in the next phases.
          </AppText>
        </Card>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Your navigation</AppText>
          <View style={styles.tabRow}>
            {tabs.map((t) => (
              <View key={t} style={[styles.tabChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: colors.onSurface }}>{t}</AppText>
              </View>
            ))}
          </View>
        </View>

        <Button testID="role-logout" label="Logout" variant="outline" onPress={doLogout} icon={<Ionicons name="log-out-outline" size={18} color={colors.onSurface} />} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  logo: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rolePill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  iconBubble: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tabChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
});
