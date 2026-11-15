import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { OwnerModuleRow } from "@/src/owner/OwnerUI";
import { DRIVER_MODULE, ownerModules, OWNER_DIRECTORY_KEYS } from "@/src/owner/modules";
import { STAFF_MODULE_GROUPS, STAFF_ROLES, StaffModuleDirectory } from "@/src/screens/StaffModuleDirectory";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

export default function RoleModules() {
  const { category } = useLocalSearchParams<{ category?: string }>();
  const { user, token, hydrating } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  const role = user.role;
  const isOwner = role === "plant_owner" || role === "owner";
  const isDriver = role === "driver";
  const isStaff = STAFF_ROLES.some(value => value === role);
  const group = STAFF_MODULE_GROUPS.find(value => value === category);
  if ((!isOwner && !isDriver && !isStaff) || !group) return <Redirect href="/role-home" />;

  const home = isOwner ? "/owner" : isDriver ? "/driver" : ("/" + role) as `/${typeof STAFF_ROLES[number]}`;
  const entries = isOwner
    ? group === "Workforce" ? [...ownerModules(OWNER_DIRECTORY_KEYS.Workforce), DRIVER_MODULE]
      : ownerModules(group === "Commercial" ? OWNER_DIRECTORY_KEYS.Commercial : [])
    : isDriver
      ? modulesForRole(role).filter(module => module.group === group && module.key !== "notifications")
      : [];

  return (
    <ThemedScreen>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary, borderColor: colors.divider }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="role-modules-back"
          onPress={() => router.canGoBack() ? router.back() : router.replace(home)} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} accessible={false} aria-hidden />
        </Pressable>
        <AppText accessibilityRole="header" variant="heading">{group}</AppText>
      </View>
      <ScrollView testID="role-modules-page" keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        {isStaff ? <StaffModuleDirectory role={role} scope="home" category={group} searchable /> :
          entries.length ? entries.map(module => <OwnerModuleRow key={module.key} module={module} compact />) :
            <AppText variant="bodyMuted">No modules available in this section.</AppText>}
      </ScrollView>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, minHeight: 52, alignItems: "center", justifyContent: "center" },
  content: { width: "100%", maxWidth: 980, alignSelf: "center", padding: spacing.lg, gap: spacing.sm },
});
