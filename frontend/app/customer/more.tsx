import React, { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { formatAccountMobile } from "@/src/auth/phone";
import { useTheme } from "@/src/theme/ThemeProvider";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { usePermissions } from "@/src/permissions/PermissionProvider";

const KYC_LABELS: Record<string, string> = {
  VERIFIED: "KYC verified",
  PENDING: "KYC pending",
  IN_PROGRESS: "KYC in progress",
  MOBILE_MISMATCH: "Mobile numbers differ",
  REVIEW_NEEDED: "KYC needs attention",
  PROFILE_INCOMPLETE: "KYC needs attention",
  DOCUMENT_NOT_SHARED: "Aadhaar consent needed",
  DOCUMENT_UNAVAILABLE: "Aadhaar unavailable",
  REJECTED: "KYC needs attention",
  REQUIRES_REVERIFICATION: "KYC retry needed",
  NOT_STARTED: "KYC not started",
};

const CUSTOMER_MORE_KEYS = [
  "customer-support",
  "account-deletion",
] as const;

export default function CustomerMore() {
  const { review } = usePermissions();
  const { colors, scheme, toggle } = useTheme();
  const { user, signOut, refreshMe } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useFocusEffect(useCallback(() => {
    void refreshMe();
  }, [refreshMe]));

  const accountStatus = user?.kyc_status || "NOT_STARTED";
  const kycVerified = accountStatus === "VERIFIED";
  const status = accountStatus === "NOT_STARTED"
    ? user?.kyc_attempt_status || accountStatus
    : accountStatus;
  const mobile = formatAccountMobile(user?.phone || user?.mobile);
  const verifiedName = kycVerified ? user?.verified_name?.trim() : null;
  const displayName = verifiedName || (user?.needs_kyc_name ? null : user?.name?.trim()) || "Customer";
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <VectorSymbol name="profile" size={35} />
            <AppText variant="title" style={{ flex: 1 }}>My Account</AppText>
            <Pressable testID="customer-more-theme" accessibilityRole="button" accessibilityLabel="Switch light or dark mode"
              onPress={toggle} style={styles.themeTarget}>
              <VectorSymbol name={scheme === "dark" ? "sun" : "moon"} size={25} color={colors.onSurface} />
            </Pressable>
          </View>
          <Card testID="customer-account-profile" style={{ gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={[styles.avatar, { backgroundColor: colors.brand }]}>
                <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onBrand }}>
                  {displayName.charAt(0).toUpperCase()}
                </AppText>
              </View>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <AppText variant="heading" testID="customer-profile-name">{displayName}</AppText>
                <AppText variant="caption" testID="customer-profile-mobile">
                  {mobile ? `Login mobile · ${mobile}` : "Login mobile unavailable"}
                </AppText>
              </View>
            </View>
            {user?.email ? <AppText variant="caption">{`Email · ${user.email}`}</AppText> : null}
            <Badge
              testID="customer-profile-kyc"
              label={KYC_LABELS[status] || "KYC needs attention"}
              status={kycVerified || status === "NOT_STARTED" ? status : "PENDING"}
            />
            <Button
              label={kycVerified ? "View KYC" : status === "NOT_STARTED" ? "Complete KYC" : "View KYC status"}
              variant="outline"
              onPress={() => router.push("/kyc?origin=profile")}
            />
          </Card>

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
                {module.symbol
                  ? <IconTile symbol={module.symbol} size={30} width={42} />
                  : <IconTile icon={module.icon} size={20} width={42} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{module.label}</AppText>
                  <AppText variant="caption" numberOfLines={2}>{module.description}</AppText>
                </View>
                <VectorSymbol name="chevron-right" size={16} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </View>

          <Pressable accessibilityRole="button" onPress={review} style={{minHeight:48,justifyContent:"center"}}><View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><VectorSymbol name="permission-settings" size={33} /><AppText variant="heading">Permission settings</AppText></View></Pressable>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
            <Button label="Privacy Policy" variant="outline" fullWidth={false} icon={<VectorSymbol name="privacy-policy" size={18} color={colors.accentText} />} onPress={() => router.push("/privacy")} />
            <Button label="Terms of Service" variant="outline" fullWidth={false} icon={<VectorSymbol name="terms-of-service" size={18} color={colors.accentText} />} onPress={() => router.push("/terms")} />
          </View>

          <Pressable testID="logout-button" onPress={doLogout} style={[styles.logout, { backgroundColor: colors.isDark ? "#96352D" : "#B42318" }]}>
            <VectorSymbol name="logout" size={23} color="#FFFFFF" />
            <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: "#FFFFFF" }}>Sign out</AppText>
          </Pressable>

        </ScrollView>
      </View>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  themeTarget: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
  },
});
