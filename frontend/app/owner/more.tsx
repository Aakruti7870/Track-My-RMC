import React from "react";
import { Pressable, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { OwnerInsights } from "@/src/owner/OwnerInsights";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { AppText } from "@/src/components/ui/AppText";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { OwnerFrame, OwnerList, OwnerModuleRow, OwnerGlass, ui, useOwnerPalette } from "@/src/owner/OwnerUI";
import { ACCOUNT_KEYS, COMMERCIAL_KEYS, DRIVER_MODULE, OPERATIONS_KEYS, WORKFORCE_KEYS, ownerModules } from "@/src/owner/modules";
export default function OwnerMore() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { directory } = useLocalSearchParams<{ directory?: string }>();
  const { mode, setMode } = useTheme();
  const p = useOwnerPalette();
  const available = new Set(modulesForRole(user?.role).map(module => module.key));
  const groups = [
    ...(directory === "1" ? [{ title: "Operations", entries: ownerModules(OPERATIONS_KEYS) }] : []),
    { title: "Workforce", entries: ownerModules(WORKFORCE_KEYS) },
    { title: "Account", entries: ownerModules(ACCOUNT_KEYS) },
    { title: "Commercial", entries: ownerModules(COMMERCIAL_KEYS) },
    { title: "Driver Management", entries: [DRIVER_MODULE] },
  ];
  return <OwnerFrame title={directory === "1" ? "All Plant Modules" : "More"} subtitle="Account, workforce, payroll and other settings">
    <OwnerList><View testID="role-module-directory" style={{ gap: 6 }}>
      {groups.map(group => <React.Fragment key={group.title}><AppText style={[ui.section, { color: p.text }]}>{group.title}</AppText>{group.entries.filter(module => available.has(module.key) || module.key === DRIVER_MODULE.key).map(module => <OwnerModuleRow key={module.key} module={module} compact />)}</React.Fragment>)}
      <Pressable testID="owner-staff-module-access" accessibilityRole="button" accessibilityLabel="Manage Staff Module Access" onPress={() => router.push("/staff-module-access")} style={{ marginVertical: 8 }}>
        <OwnerGlass style={{ padding: 15, gap: 10, flexDirection: "row", alignItems: "center" }}>
          <VectorSymbol name="plant-staff" size={52} warmAccent />
          <View style={{ flex: 1, gap: 3 }}>
          <AppText style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Manage Staff Module Access</AppText>
          <AppText style={{ color: p.muted, fontSize: 12 }}>All eight roles · plant-scoped · audited access</AppText>
          </View>
        </OwnerGlass>
      </Pressable>
      <Pressable testID="owner-permission-settings" accessibilityRole="button" accessibilityLabel="App permissions" onPress={() => router.push("/permission-settings")} style={{ marginVertical: 8 }}>
        <OwnerGlass style={{ padding: 15, gap: 10, flexDirection: "row", alignItems: "center" }}>
          <VectorSymbol name="permission-settings" size={44} warmAccent />
          <View style={{ flex: 1 }}>
            <AppText style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>App permissions</AppText>
            <AppText style={{ color: p.muted, fontSize: 12 }}>Manage Android location and notification access</AppText>
          </View>
        </OwnerGlass>
      </Pressable>
      <OwnerInsights />
      <AppText style={[ui.section, { color: p.text }]}>Appearance</AppText>
      <OwnerGlass style={{ padding: 12, flexDirection: "row", gap: 8 }}>
        {(["light", "dark", "system"] as const).map(option => <Pressable testID={`owner-theme-${option}`} key={option} accessibilityRole="radio" accessibilityState={{ checked: mode === option }} onPress={() => setMode(option)} style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: mode === option ? p.accent : "transparent" }}><AppText center style={{ color: mode === option ? "#FFFFFF" : p.text, fontSize: 12 }}>{option.charAt(0).toUpperCase() + option.slice(1)}</AppText></Pressable>)}
      </OwnerGlass>
      <Pressable testID="owner-logout" accessibilityRole="button" onPress={async () => { await signOut(); router.replace("/login"); }} style={{ padding: 18, alignItems: "center" }}><AppText color={p.dark ? "#FF9F98" : "#B42318"}>Sign out</AppText></Pressable>
    </View></OwnerList>
  </OwnerFrame>;
}
