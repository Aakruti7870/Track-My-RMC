import React from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth/AuthContext";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { AppText } from "@/src/components/ui/AppText";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { OwnerFrame, OwnerList, OwnerModuleRow, OwnerGlass, ui, useOwnerPalette } from "@/src/owner/OwnerUI";
import { ACCOUNT_KEYS, ownerModules } from "@/src/owner/modules";
import { fonts } from "@/src/theme/tokens";

export default function OwnerMore() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const p = useOwnerPalette();
  const { width } = useWindowDimensions();
  const available = new Set(modulesForRole(user?.role).map(module => module.key));
  const account = ownerModules(ACCOUNT_KEYS).filter(module => available.has(module.key));
  const twoColumns = width >= 540;
  return <OwnerFrame title="More" subtitle="Plant identity, access and device preferences">
    <OwnerList>
      <View testID="role-module-directory" style={styles.content}>
        <AppText style={[ui.section, { color: p.text }]}>Account</AppText>
        {account.map(module => <OwnerModuleRow key={module.key} module={module} compact />)}
        <View style={[styles.management, { flexDirection: twoColumns ? "row" : "column" }]}>
          <Pressable testID="owner-staff-module-access" accessibilityRole="button"
            accessibilityLabel="Manage Staff Module Access" onPress={() => router.push("/staff-module-access")}
            style={{ flex: 1 }}>
            <OwnerGlass style={styles.action}>
              <VectorSymbol name="plant-staff" size={39} warmAccent />
              <View style={styles.actionCopy}>
                <AppText style={[styles.title, { color: p.text }]}>Manage Staff Module Access</AppText>
                <AppText style={[styles.subtitle, { color: p.muted }]}>All eight roles · plant-scoped · audited access</AppText>
              </View>
            </OwnerGlass>
          </Pressable>
          <Pressable testID="owner-permission-settings" accessibilityRole="button" accessibilityLabel="App permissions"
            onPress={() => router.push("/permission-settings")} style={{ flex: 1 }}>
            <OwnerGlass style={styles.action}>
              <VectorSymbol name="permission-settings" size={36} warmAccent />
              <View style={styles.actionCopy}>
                <AppText style={[styles.title, { color: p.text }]}>App permissions</AppText>
                <AppText style={[styles.subtitle, { color: p.muted }]}>Manage Android location and notification access</AppText>
              </View>
            </OwnerGlass>
          </Pressable>
        </View>
        <Pressable testID="owner-logout" accessibilityRole="button" accessibilityLabel="Sign out"
          onPress={async () => { await signOut(); router.replace("/login"); }}
          style={({ pressed }) => [styles.signOut, { backgroundColor: p.dark ? "#96352D" : "#B42318", opacity: pressed ? 0.88 : 1 }]}>
          <Ionicons name="log-out-outline" size={22} color="#FFFFFF" />
          <AppText style={styles.signOutText}>Sign out</AppText>
        </Pressable>
      </View>
    </OwnerList>
  </OwnerFrame>;
}

const styles = StyleSheet.create({
  content: { gap: 8 },
  management: { gap: 9, marginTop: 10 },
  action: { minHeight: 91, padding: 11, flexDirection: "row", alignItems: "center", gap: 9 },
  actionCopy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  subtitle: { fontSize: 11, lineHeight: 15 },
  signOut: { minHeight: 49, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 11 },
  signOutText: { fontFamily: fonts.bold, fontSize: 14, color: "#FFFFFF" },
});
