import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { apiGet } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { fonts, radius, spacing } from "@/src/theme/tokens";
import { modulesForRole, type ModuleGroup, type RoleModule } from "@/src/navigation/moduleCatalog";

/**
 * Staff-only navigation surface. The shared RoleModuleDirectory remains
 * unchanged because the Driver post-login screen uses that component.
 * A visible card never authorizes an API request.
 */
export const STAFF_ROLES = [
  "admin", "dispatcher", "operator", "supervisor", "accountant",
  "quality_engineer", "fleet_manager", "store_manager",
] as const;

export const STAFF_MODULE_PERMISSIONS: Readonly<Record<string, string>> = {
  "admin-orders": "dispatch_queue",
  "admin-fleet": "fleet_availability",
  "dispatcher-queue": "dispatch_queue",
  "dispatcher-fleet": "fleet_availability",
  "operator-production": "production_queue",
  "supervisor-operations": "production_queue",
  "supervisor-incidents": "incidents",
  "accountant-billing": "billing_ledger",
  "accountant-ledger": "billing_ledger",
  "engineer-quality": "quality_register",
  "fleet-manager-fleet": "fleet_availability",
  "fleet-manager-drivers": "driver_roster",
  "store-manager-stock": "material_inventory",
  "business-rates": "rate_cards",
  "business-mixes": "mix_designs",
  "business-inventory": "material_inventory",
  "business-suppliers": "suppliers",
  "business-purchases": "purchases",
  "business-fleet": "fleet_availability",
  "business-diesel": "diesel_ledger",
  "business-quotations": "quotations",
  "business-expenses": "expenses",
  "business-payroll": "payroll",
  "business-reports": "plant_reports",
  "workforce-reports": "workforce",
  "employee-master": "employee_master",
  "payroll-closure": "payroll",
};

// Native role tabs already expose these modules. Do not render a second shortcut.
export const STAFF_TAB_KEYS: Readonly<Record<string, readonly string[]>> = {
  admin: ["admin-orders", "admin-fleet"],
  dispatcher: ["dispatcher-queue", "dispatcher-fleet"],
  operator: ["operator-production"],
  supervisor: ["supervisor-operations", "supervisor-incidents"],
  accountant: ["accountant-billing", "accountant-ledger"],
  quality_engineer: ["engineer-quality"],
  fleet_manager: ["fleet-manager-fleet", "fleet-manager-drivers"],
  store_manager: ["store-manager-stock"],
};
// Six useful role-specific cards stay on Home; the remaining allowed catalog
// destinations are on More. Each route appears at most once per role directory.
export const STAFF_HOME_KEYS: Readonly<Record<string, readonly string[]>> = {
  admin: ["business-inventory", "business-staff", "business-reports", "business-fleet", "business-attendance", "business-mixes"],
  dispatcher: ["business-inventory", "business-attendance", "business-reports", "public-plant-profile", "shift-roster", "workforce"],
  operator: ["business-mixes", "business-inventory", "business-attendance", "business-reports", "shift-roster", "my-payslip"],
  supervisor: ["business-mixes", "business-inventory", "business-attendance", "business-reports", "shift-roster", "workforce"],
  accountant: ["business-rates", "business-quotations", "business-expenses", "business-payroll", "employee-master", "workforce-reports"],
  quality_engineer: ["business-mixes", "business-inventory", "business-reports", "business-attendance", "public-plant-profile", "shift-roster"],
  fleet_manager: ["business-diesel", "business-attendance", "business-reports", "shift-roster", "my-payslip", "workforce"],
  store_manager: ["business-inventory", "business-suppliers", "business-purchases", "business-diesel", "business-reports", "business-attendance"],
};
export type StaffModuleScope = "home" | "more" | "all";
export function staffModulesForScope(role: string | null | undefined, scope: StaffModuleScope): RoleModule[] {
  const tabKeys = STAFF_TAB_KEYS[role || ""] || [];
  const homeKeys = STAFF_HOME_KEYS[role || ""] || [];
  const seen = new Set<string>();
  return modulesForRole(role).filter(module => {
    if (module.key === "notifications") return false; // Bell is in the shared top bar.
    if (scope !== "all" && (tabKeys.includes(module.key) ||
      (scope === "home" ? !homeKeys.includes(module.key) : homeKeys.includes(module.key)))) return false;
    const routeKey = typeof module.route === "string" ? module.route : JSON.stringify(module.route);
    if (seen.has(routeKey)) return false;
    seen.add(routeKey);
    return true;
  });
}

// Only existing functional destinations are eligible: do not turn design ideas
// into new routes without an accompanying API, permission and data contract.
const GROUPS: ModuleGroup[] = ["Operations", "Commercial", "Workforce", "Tools", "Account"];
type Grant = { key: string; view: boolean };

export function StaffModuleDirectory({
  role, title = "Your modules", searchable = false, scope = "all",
}: { role?: string | null; title?: string; searchable?: boolean; scope?: StaffModuleScope }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ModuleGroup | "All">("All");
  const validRole = !!role && STAFF_ROLES.some(value => value === role);

  useFocusEffect(useCallback(() => {
    if (!validRole || !token) {
      setAllowed([]);
      setPermissionError(true);
      return;
    }
    let active = true;
    setAllowed(null);
    setPermissionError(false);
    apiGet<{ permissions: Grant[] }>("/staff/module-permissions", token)
      .then(result => {
        if (active) setAllowed(result.permissions.filter(grant => grant.view).map(grant => grant.key));
      })
      .catch(() => {
        if (active) {
          setAllowed([]);
          setPermissionError(true);
        }
      });
    return () => { active = false; };
  }, [token, validRole, role]));

  // The Owner's audited grant matrix controls access, never the card layout.
  // Promote permitted work modules into the same compact Home grid (up to eight);
  // any overflow stays on More. No module appears on both home and more.
  const scopedModules = useMemo(() => {
    if (scope === "all") return staffModulesForScope(role, "all");
    const enabled = (item: RoleModule) => {
      const permission = STAFF_MODULE_PERMISSIONS[item.key];
      return !permission || (allowed || []).includes(permission);
    };
    const home = staffModulesForScope(role, "home").filter(enabled);
    const extras = staffModulesForScope(role, "more").filter(item =>
      !!STAFF_MODULE_PERMISSIONS[item.key] && enabled(item));
    const routes = new Set(home.map(item => String(item.route)));
    for (const module of extras) {
      if (home.length >= 8) break;
      if (!routes.has(String(module.route))) {
        home.push(module);
        routes.add(String(module.route));
      }
    }
    return scope === "home" ? home :
      staffModulesForScope(role, "more").filter(item => !routes.has(String(item.route)));
  }, [role, scope, allowed]);
  const modules = useMemo(() => scopedModules.filter(item => {
    const key = STAFF_MODULE_PERMISSIONS[item.key];
    if (key && !(allowed || []).includes(key)) return false;
    if (group !== "All" && item.group !== group) return false;
    const needle = query.trim().toLowerCase();
    return !needle || (item.label + " " + item.description).toLowerCase().includes(needle);
  }), [scopedModules, allowed, group, query]);

  const allVisible = useMemo(() => scopedModules.filter(item => {
    const key = STAFF_MODULE_PERMISSIONS[item.key];
    return !key || (allowed || []).includes(key);
  }), [scopedModules, allowed]);

  // Tablet/desktop gets additional columns; on phones every card has enough
  // width for its label and maintains a 44pt+ touch target.
  const cols = width >= 950 ? 5 : width >= 680 ? 4 : width >= 470 ? 3 : 2;
  const contentWidth = Math.max(0, Math.min(width, 980) - 2 * spacing.lg);
  const cardWidth = Math.max(0, (contentWidth - (cols - 1) * 9) / cols);

  if (!validRole) return null;
  return (
    <View testID="role-module-directory" style={styles.wrapper}>
      <View style={styles.heading}>
        <View style={{ flex: 1, gap: 3 }}>
          <AppText variant="heading">{title}</AppText>
          <AppText variant="caption">{allVisible.length} available destinations · access controlled by your plant</AppText>
        </View>
        <View style={[styles.count, { backgroundColor: colors.brandSoft }]}>
          <AppText style={{ color: colors.onBrandSoft, fontFamily: fonts.bold, fontSize: 13 }}>{allVisible.length}</AppText>
        </View>
      </View>

      {searchable ? (
        <>
          <View style={[styles.search, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="staff-module-search"
              accessibilityLabel="Search your modules"
              value={query}
              onChangeText={setQuery}
              placeholder="Find a module"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={{ flex: 1, color: colors.onSurface, fontFamily: fonts.regular, fontSize: 14, minHeight: 44 }}
            />
            {query ? <Pressable testID="staff-module-clear" accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")} hitSlop={10}>
              <Ionicons name="close-circle" size={21} color={colors.onSurfaceTertiary} />
            </Pressable> : null}
          </View>
          <View style={styles.filters}>
            {(["All", ...GROUPS] as const).map(g => {
              if (g !== "All" && !allVisible.some(m => m.group === g)) return null;
              const selected = group === g;
              return (
                <Pressable key={g} testID={"staff-group-" + g.toLowerCase()}
                  accessibilityRole="button" accessibilityState={{ selected }}
                  onPress={() => setGroup(g)}
                  style={[styles.filter, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}>
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: selected ? colors.onBrand : colors.onSurface }}>{g}</AppText>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {permissionError ? (
        <View style={[styles.notice, { backgroundColor: colors.errorSoft }]}>
          <Ionicons name="shield-outline" size={17} color={colors.error} />
          <AppText style={{ color: colors.error, flex: 1, fontSize: 12 }}>
            Access could not be verified. Protected modules are hidden until permissions reload.
          </AppText>
        </View>
      ) : null}

      {allowed === null ? <AppText variant="caption">Checking staff permissions…</AppText> : null}
      {GROUPS.map(category => {
        if (group !== "All" && group !== category) return null;
        const entries = modules.filter(m => m.group === category);
        if (!entries.length) return null;
        return (
          <View key={category} style={{ gap: spacing.sm }}>
            <View style={styles.groupTitle}>
              <View style={[styles.groupMark, { backgroundColor: colors.brand }]} />
              <AppText variant="label">{category}</AppText>
            </View>
            <View style={styles.grid}>
              {entries.map(module => (
                <Pressable key={module.key} testID={"role-module-" + module.key}
                  accessibilityRole="button" accessibilityLabel={module.label}
                  accessibilityHint={module.description}
                  onPress={() => router.push(module.route)}
                  style={({ pressed }) => [
                    styles.card, {
                      width: cardWidth,
                      backgroundColor: colors.surfaceSecondary,
                      borderColor: colors.isDark ? "rgba(255,159,82,0.31)" : "rgba(255,255,255,0.98)",
                      shadowColor: colors.isDark ? "#F08928" : "#7B5845",
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}>
                  <View style={styles.iconWrap}>
                    {module.symbol ? <VectorSymbol name={module.symbol} size={38} warmAccent /> :
                      <Ionicons name={module.icon} size={30} color={colors.brand} />}
                  </View>
                  <AppText numberOfLines={2} style={[styles.cardTitle, { color: colors.onSurface }]}>{module.label}</AppText>
                  <AppText numberOfLines={2} style={[styles.cardDescription, { color: colors.onSurfaceTertiary }]}>{module.description}</AppText>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {allowed !== null && modules.length === 0 ? (
        <View style={[styles.notice, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="grid-outline" size={20} color={colors.onSurfaceTertiary} />
          <AppText variant="bodyMuted">No modules match this filter or your current access.</AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.md },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  count: { minWidth: 38, minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingHorizontal: 8 },
  groupTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupMark: { height: 16, width: 3, borderRadius: 3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  card: { minHeight: 132, maxWidth: "100%", borderWidth: 1, borderRadius: 16, padding: 8, alignItems: "center", justifyContent: "center", gap: 4,
    shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.09, shadowRadius: 12, elevation: 2 },
  iconWrap: { height: 42, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 12, textAlign: "center", lineHeight: 16 },
  cardDescription: { fontFamily: fonts.regular, fontSize: 10, textAlign: "center", lineHeight: 14 },
  search: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: { borderRadius: radius.pill, borderWidth: 1, minHeight: 38, paddingHorizontal: 13, paddingVertical: 10, justifyContent: "center" },
  notice: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: radius.md, padding: 12 },
});
