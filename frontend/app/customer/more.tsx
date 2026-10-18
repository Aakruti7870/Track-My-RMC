import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { usePermissions } from "@/src/permissions/PermissionProvider";

const MODES: { key: "system" | "light" | "dark"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
  { key: "system", label: "System", icon: "phone-portrait-outline" },
];

// Customer More is a five-link settings/documentation menu, not the full
// role directory. Keep the shared catalog intact for authorization and Home.
const CUSTOMER_MORE_KEYS = [
  "account-deletion",
  "customer-support",
  "notifications",
  "quotations",
  "documents",
] as const;

export default function CustomerMore() {
  const { review } = usePermissions();
  const { colors, mode, setMode } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const kycVerified = user?.kyc_status === "VERIFIED";
  const mobile = user?.phone || user?.mobile;
  const customerModules = modulesForRole(user?.role);
  const moreModules = CUSTOMER_MORE_KEYS.flatMap(key => customerModules.filter(module => module.key === key));

  const doLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <ThemedScreen>
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><VectorSymbol name="settings" size={35} /><AppText variant="title">More</AppText></View>
        <Pressable accessibilityRole="button" onPress={review} style={{minHeight:48,justifyContent:"center"}}><View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><VectorSymbol name="permission-settings" size={33} /><AppText variant="heading">Permission settings</AppText></View></Pressable>

        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={[styles.avatar, { backgroundColor: colors.brand }]}>
            <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onBrand }}>
              {(user?.name || "C").charAt(0).toUpperCase()}
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="heading" numberOfLines={1}>{user?.name}</AppText>
            <AppText variant="caption">{user?.phone || user?.email}</AppText>
            <View style={{ flexDirection: "row", gap: spacing.xs }}>
              <Badge label={user?.role_label || "Customer"} color={colors.brand} />
              <Badge label={`KYC ${user?.kyc_status?.replace(/_/g, " ")}`} status={user?.kyc_status} />
            </View>
          </View>
        </Card>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">PERSONAL DETAILS</AppText>
          <Card style={{ gap: spacing.lg }}>
            <View style={{ gap: 4 }}>
              <AppText variant="caption">Name</AppText>
              <AppText variant="heading">{kycVerified && user?.name ? user.name : "Complete DigiLocker KYC"}</AppText>
              {kycVerified && user?.name ? <Badge label="KYC VERIFIED" status="VERIFIED" /> : null}
            </View>
            <View style={{ gap: 4 }}>
              <AppText variant="caption">Mobile number</AppText>
              <AppText variant="heading">{mobile || "Unavailable"}</AppText>
              {mobile ? <Badge label="VERIFIED" status="VERIFIED" /> : null}
            </View>
            <View style={{ gap: 4 }}>
              <AppText variant="caption">Email ID</AppText>
              <AppText variant="heading">{user?.email || "Not added"}</AppText>
            </View>
            <Pressable onPress={() => router.push("/kyc")} style={[styles.kycAction, { borderColor: colors.brand }]}>
              <AppText style={{ color: colors.brand, fontFamily: fonts.semibold }}>
                {kycVerified ? "Manage KYC" : "Complete KYC"}
              </AppText>
            </Pressable>
          </Card>
        </View>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Appearance</AppText>
          <View style={styles.modeRow}>
            {MODES.map((m) => {
              const selected = mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  testID={`theme-mode-${m.key}`}
                  onPress={() => setMode(m.key)}
                  style={[
                    styles.mode,
                    { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border },
                  ]}
                >
                  <Ionicons name={m.icon} size={18} color={selected ? colors.onBrand : colors.onSurfaceSecondary} />
                  <AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm, color: selected ? colors.onBrand : colors.onSurfaceSecondary }}>
                    {m.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View testID="role-module-directory" style={{ gap: spacing.sm }}>
          {moreModules.map(module => (
            <Pressable
              key={module.key}
              testID={`role-module-${module.key}`}
              accessibilityRole="button"
              accessibilityLabel={module.label}
              onPress={() => router.push(module.route)}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={[styles.moduleIcon, { backgroundColor: colors.brandSoft }]}>
                {module.symbol
                  ? <VectorSymbol name={module.symbol} size={36} />
                  : <Ionicons name={module.icon} size={19} color={colors.brand} />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{module.label}</AppText>
                <AppText variant="caption" numberOfLines={2}>{module.description}</AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
        </View>

        <Card style={{ gap: 4 }}>
          <AppText variant="label">Legal & support</AppText>
          <AppText variant="caption">Privacy Policy, Terms of Service and official support details must use your approved business/legal content before release. No placeholder policy text is shown.</AppText>
        </Card>

        <Pressable testID="logout-button" onPress={doLogout} style={[styles.logout, { borderColor: colors.error }]}>
          <VectorSymbol name="logout" size={27} />
          <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.error }}>Logout</AppText>
        </Pressable>

        <AppText variant="caption" center>TrackMyRMC · 2.0.16 (74)</AppText>
      </ScrollView>
    </View>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  modeRow: { flexDirection: "row", gap: spacing.sm },
  mode: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  moduleIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  kycAction: { height: 44, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
