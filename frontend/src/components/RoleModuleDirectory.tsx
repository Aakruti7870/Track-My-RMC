import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { apiGet } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";

import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";
import { modulesForRole, type ModuleGroup } from "@/src/navigation/moduleCatalog";

// Navigational discovery only. Server-side RBAC and tenant/plant checks remain
// mandatory for every API call; this list must never elevate a role.
const GROUPS: ModuleGroup[] = ["Operations", "Commercial", "Workforce", "Tools", "Account"];

export function RoleModuleDirectory({ role, title = "Your Modules" }: {
  role?: string | null;
  title?: string;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const { token } = useAuth();
  const [allowed, setAllowed] = useState<string[] | null>(null);
  // A hidden link is never the permission boundary; Rust checks every action.
  // Fail closed for guarded links until the server confirms effective grants.
  useFocusEffect(useCallback(() => {
    if (!role || !["admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"].includes(role) || !token) { setAllowed(null); return; }
    let active = true;
    setAllowed(null);
    apiGet<{ permissions: Array<{key: string; view: boolean}> }>("/staff/module-permissions", token)
      .then(r => { if (active) setAllowed(r.permissions.filter(p => p.view).map(p => p.key)); })
      .catch(() => { if (active) setAllowed([]); });
    return () => { active = false; };
  }, [role, token]));
  const moduleKey: Record<string, string> = {
    "admin-orders": "dispatch_queue", "admin-fleet": "fleet_availability",
    "dispatcher-queue": "dispatch_queue", "dispatcher-fleet": "fleet_availability",
    "operator-production": "production_queue", "supervisor-operations": "production_queue",
    "supervisor-incidents": "incidents", "accountant-billing": "billing_ledger",
    "accountant-ledger": "billing_ledger", "engineer-quality": "quality_register",
    "fleet-manager-fleet": "fleet_availability", "fleet-manager-drivers": "driver_roster",
    "store-manager-stock": "material_inventory", "business-rates": "rate_cards",
    "business-mixes": "mix_designs", "business-inventory": "material_inventory",
    "business-suppliers": "suppliers", "business-purchases": "purchases",
    "business-fleet": "fleet_availability", "business-diesel": "diesel_ledger",
    "business-quotations": "quotations", "business-expenses": "expenses",
    "business-payroll": "payroll", "business-attendance": "workforce",
    "business-reports": "plant_reports", "workforce": "workforce",
    "workforce-reports": "workforce", "employee-master": "employee_master",
    "payroll-closure": "payroll",
  };
  const guardedRole = !!role && ["admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"].includes(role);
  const modules = modulesForRole(role).filter(m => !guardedRole
    || !moduleKey[m.key] || (allowed || []).includes(moduleKey[m.key]));

  if (modules.length === 0) return null;
  return (
    <View testID="role-module-directory" style={{ gap: spacing.md }}>
      <View style={styles.heading}>
        <AppText variant="heading">{title}</AppText>
        <AppText variant="caption">{modules.length} available destinations</AppText>
      </View>
      {GROUPS.map((group) => {
        const entries = modules.filter(module => module.group === group);
        if (!entries.length) return null;
        return (
          <View key={group} style={{ gap: spacing.sm }}>
            <AppText variant="label">{group}</AppText>
            <View style={styles.cards}>
              {entries.map(module => (
                <Pressable
                  key={module.key}
                  testID={`role-module-${module.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={module.label}
                  onPress={() => router.push(module.route)}
                  style={({ pressed }) => [
                    styles.item,
                    {
                      backgroundColor: colors.isDark ? "rgba(31,34,39,0.86)" : "rgba(255,255,255,0.84)",
                      borderColor: colors.isDark ? "rgba(255,161,93,0.25)" : "rgba(255,255,255,0.96)",
                      opacity: pressed ? 0.76 : 1,
                    },
                  ]}
                >
                  <View style={styles.artwork}>
                    {module.symbol ? <VectorSymbol name={module.symbol} size={52} warmAccent /> : <Ionicons name={module.icon} size={38} color={colors.brand} />}
                  </View>
                  <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface, fontSize: 13, textAlign: "center" }} numberOfLines={2}>{module.label}</AppText>
                  <AppText variant="caption" style={{ textAlign: "center", fontSize: 11 }} numberOfLines={2}>{module.description}</AppText>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  item: { width: "48%", minWidth: 142, flexGrow: 1, minHeight: 154, alignItems: "center",
    justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: 20, padding: 12,
    shadowColor: "#AB6A3A", shadowOpacity: 0.11, shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  artwork: { height: 58, alignItems: "center", justifyContent: "center" },
});
