import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { AppText } from "@/src/components/ui/AppText";
import { OwnerFrame, OwnerGlass, OwnerLinkRow, OwnerList, ui, useOwnerPalette } from "@/src/owner/OwnerUI";
import { ACCOUNT_KEYS, ownerModules } from "@/src/owner/modules";
import { useTheme } from "@/src/theme/ThemeProvider";

export default function OwnerMore() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const p = useOwnerPalette();
  const { colors } = useTheme();
  const available = new Set(modulesForRole(user?.role).map(module => module.key));
  const account = ownerModules(ACCOUNT_KEYS).filter(module => available.has(module.key));

  return <OwnerFrame matte title="More">
    <OwnerList reserveNavigation>
      <OwnerGlass testID="role-module-directory" highlighted={false} style={ui.group}>
        <AppText accessibilityRole="header" style={[ui.groupHeading, { backgroundColor: p.canvas }]}>Plant &amp; Account</AppText>
        <View style={ui.groupRows}>
          {account.map((module, index) => <OwnerLinkRow key={module.key} testID={`role-module-${module.key}`}
            title={module.label} symbol={module.symbol ?? "profile"} route={module.route} divider={index > 0} />)}
        </View>
      </OwnerGlass>
      <OwnerGlass highlighted={false} style={ui.group}>
        <AppText accessibilityRole="header" style={[ui.groupHeading, { backgroundColor: p.canvas }]}>Team &amp; Access</AppText>
        <View style={ui.groupRows}>
          <OwnerLinkRow testID="owner-workforce-directory" title="Workforce" symbol="workforce"
            route={{ pathname: "/role-modules", params: { category: "Workforce" } }} />
          <OwnerLinkRow testID="owner-staff-module-access" title="Manage Staff Module Access"
            symbol="plant-staff" route="/staff-module-access" divider />
          <OwnerLinkRow testID="owner-permission-settings" title="App permissions"
            symbol="permission-settings" route="/permission-settings" divider />
        </View>
      </OwnerGlass>
      <OwnerGlass highlighted={false} style={ui.group}>
        <AppText accessibilityRole="header" style={[ui.groupHeading, { backgroundColor: p.canvas }]}>Help</AppText>
        <View style={ui.groupRows}>
          <OwnerLinkRow testID="owner-support" title="Support" symbol="support" route="/support" />
        </View>
      </OwnerGlass>
      <Pressable testID="owner-logout" accessibilityRole="button" accessibilityLabel="Sign out"
        onPress={async () => { await signOut(); router.replace("/login"); }}
        style={({ pressed }) => [styles.signOut, { borderColor: colors.error, backgroundColor: p.panel, opacity: pressed ? 0.75 : 1 }]}>
        <VectorSymbol name="logout" size={20} color={colors.error} />
        <AppText variant="label" color={colors.error} style={{ flex: 1 }}>Sign out</AppText>
        <VectorSymbol name="chevron-right" size={17} color={colors.error} />
      </Pressable>
    </OwnerList>
  </OwnerFrame>;
}

const styles = StyleSheet.create({
  signOut: {
    borderWidth: 1, borderRadius: 12, minHeight: 49, paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
});
