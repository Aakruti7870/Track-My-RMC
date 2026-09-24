import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Href, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const ITEMS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: Href }[] = [
  { key: "projects", label: "Project & Site Hub", icon: "briefcase-outline", route: "/customer/projects" },
  { key: "pour_planner", label: "Concrete Pour Planner", icon: "time-outline", route: "/customer/pour-planner" },
  { key: "receiving", label: "Receiving & Quality Guide", icon: "shield-checkmark-outline", route: "/customer/receiving-guide" },
  { key: "cube_follow_up", label: "Cube Test Follow-up", icon: "flask-outline", route: "/customer/cube-test-follow-up" },
  { key: "tools", label: "Free RMC Tools", icon: "calculator-outline", route: "/customer/free-tools" },
  { key: "compare", label: "Estimate & Compare Plants", icon: "git-compare-outline", route: "/customer/compare-plants" },
  { key: "kyc", label: "KYC Verification", icon: "id-card-outline", route: "/kyc" },
  { key: "sites", label: "Saved Sites", icon: "location-outline", route: "/customer/sites" },
  { key: "quotations", label: "Quotations", icon: "document-text-outline", route: "/customer/quotations" },
  { key: "notifications", label: "Notifications", icon: "notifications-outline", route: "/notifications" },
  { key: "documents", label: "Documents", icon: "folder-outline", route: "/customer/documents" },
  { key: "delete", label: "Account Deletion", icon: "trash-outline", route: "/account-deletion" },
];

const MODES: { key: "system" | "light" | "dark"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
  { key: "system", label: "System", icon: "phone-portrait-outline" },
];

export default function CustomerMore() {
  const { colors, mode, setMode } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const kycVerified = user?.kyc_status === "VERIFIED";
  const mobile = user?.phone || user?.mobile;

  const doLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <AppText variant="title">More</AppText>

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

        <Card padded={false}>
          {ITEMS.map((item, i) => (
            <Pressable
              key={item.key}
              testID={`more-${item.key}`}
              onPress={() => router.push(item.route)}
              style={[styles.item, i < ITEMS.length - 1 && { borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }]}
            >
              <Ionicons name={item.icon} size={20} color={item.key === "delete" ? colors.error : colors.onSurfaceSecondary} />
              <AppText style={{ flex: 1, fontFamily: fonts.medium, fontSize: fontSize.base, color: item.key === "delete" ? colors.error : colors.onSurface }}>
                {item.label}
              </AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
        </Card>

        <Card style={{ gap: 4 }}>
          <AppText variant="label">Legal & support</AppText>
          <AppText variant="caption">Privacy Policy, Terms of Service and official support details must use your approved business/legal content before release. No placeholder policy text is shown.</AppText>
        </Card>

        <Pressable testID="logout-button" onPress={doLogout} style={[styles.logout, { borderColor: colors.error }]}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.error }}>Logout</AppText>
        </Pressable>

        <AppText variant="caption" center>TrackMyRMC · 2.0.16 (74)</AppText>
      </ScrollView>
    </View>
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
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
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
