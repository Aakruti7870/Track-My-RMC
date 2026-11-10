import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { apiGet } from "@/src/api/client";
import { useTheme } from "@/src/theme/ThemeProvider";
import { StaffModuleDirectory } from "@/src/screens/StaffModuleDirectory";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { OperationalHomeTopBar } from "@/src/components/OperationalHomeTopBar";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export function StaffMore() {
  const { colors } = useTheme();
  const { user, token, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [managerEnabled, setManagerEnabled] = React.useState(false);
  const [managerResources,setManagerResources]=React.useState({fleet:false,drivers:false,permissions:false});
  React.useEffect(() => {
    if (!token || !user?.role || !["dispatcher","operator","supervisor","accountant",
      "quality_engineer","fleet_manager","store_manager"].includes(user.role)) {
      setManagerEnabled(false);
      return;
    }
    let live = true;
    setManagerEnabled(false);
    apiGet<{ enabled: boolean;can_manage_staff?:boolean;can_manage_fleet?:boolean;can_manage_drivers?:boolean;can_manage_permissions?:boolean }>("/staff/manager-access", token)
      .then(result => { if (live) {setManagerEnabled(result.enabled === true && result.can_manage_staff===true);setManagerResources({fleet:result.enabled && result.can_manage_fleet===true,drivers:result.enabled && result.can_manage_drivers===true,permissions:result.enabled && result.can_manage_permissions===true});} })
      .catch(() => { if (live) setManagerEnabled(false); });
    return () => { live = false; };
  }, [token, user?.role]);

  const doLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "transparent" }}>
      <View style={{ height: insets.top }} />
      <OperationalHomeTopBar />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md, width: "100%", maxWidth: 980, alignSelf: "center" }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><VectorSymbol name="settings" size={35} /><AppText variant="title">More</AppText></View>

        <Card variant="elevated" style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={[styles.avatar, { backgroundColor: colors.brand }]}>
            <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onBrand }}>
              {(user?.name || "U").charAt(0).toUpperCase()}
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="heading" numberOfLines={1}>{user?.name}</AppText>
            <AppText variant="caption">{user?.email || user?.phone}</AppText>
            <View style={{ flexDirection: "row", gap: spacing.xs }}><Badge label={user?.role_label || "Staff"} color={colors.brand} /></View>
          </View>
        </Card>

        {managerEnabled ? (
          <Pressable testID="staff-manager-workspace" accessibilityRole="button"
            accessibilityLabel="Manage plant staff"
            onPress={() => router.push("/business/staff")}
            style={[styles.manage, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <VectorSymbol name="plant-staff" size={33} />
            <View style={{ flex: 1 }}>
              <AppText variant="heading">Plant Manager · Staff Management</AppText>
              <AppText variant="caption">Manage assigned employees and their role permissions</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        ) : null}

        {managerResources.drivers ? <Pressable accessibilityRole="button" onPress={()=>router.push("/owner/drivers")}><AppText>Manage delegated Drivers</AppText></Pressable> : null}
        {managerResources.permissions ? <Pressable accessibilityRole="button" onPress={()=>router.push("/staff-module-access")}><AppText>Manage delegated module permissions</AppText></Pressable> : null}
        <StaffModuleDirectory role={user?.role} title="Other modules" scope="more" searchable />

        <Pressable testID="staff-permission-settings" accessibilityRole="button" accessibilityLabel="App permissions"
          onPress={() => router.push("/permission-settings")}
          style={[styles.manage, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <VectorSymbol name="permission-settings" size={33} />
          <View style={{ flex: 1 }}>
            <AppText variant="heading">App permissions</AppText>
            <AppText variant="caption">Review Android location and notification access</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable testID="logout-button" accessibilityRole="button" accessibilityLabel="Sign out of staff account" onPress={doLogout} style={[styles.logout, { backgroundColor: colors.isDark ? "#96352D" : "#B42318" }]}><Ionicons name="log-out-outline" size={22} color="#FFFFFF" /><AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: "#FFFFFF" }}>Sign out</AppText></Pressable>
        <AppText variant="caption" center>TrackMyRMC · v2.0.18 (76)</AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radius.md },
  manage: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
});
