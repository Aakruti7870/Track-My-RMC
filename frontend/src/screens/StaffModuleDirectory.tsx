import { VectorSymbol } from "@/src/components/VectorSymbol";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { apiGet } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { IconTile } from "@/src/components/IconTile";
import { fonts, radius, spacing } from "@/src/theme/tokens";
import { modulesForRole, type ModuleGroup, type RoleModule } from "@/src/navigation/moduleCatalog";

// Rust authorizes each request. This list controls discovery for staff.
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
// Pick the first shortcuts in each category after applying effective grants.
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
export const STAFF_MORE_KEYS = ["public-plant-profile", "my-payslip"] as const;
export type StaffModuleScope = "home" | "more" | "all";
export function staffModulesForScope(role: string | null | undefined, scope: StaffModuleScope): RoleModule[] {
  const tabKeys = STAFF_TAB_KEYS[role || ""] || [];
  const moreKeys: readonly string[] = STAFF_MORE_KEYS;
  const preferred = STAFF_HOME_KEYS[role || ""] || [];
  const seen = new Set<string>();
  const available = modulesForRole(role).filter(module => {
    if (module.key === "notifications") return false; // The top-bar bell is canonical.
    if (scope !== "all" && tabKeys.includes(module.key)) return false;
    const personal = moreKeys.includes(module.key);
    if (scope === "home" && personal) return false;
    if (scope === "more" && !personal) return false;
    const routeKey = typeof module.route === "string" ? module.route : JSON.stringify(module.route);
    if (seen.has(routeKey)) return false;
    seen.add(routeKey);
    return true;
  });
  return scope === "home"
    ? available.sort((a, b) => {
        const i = preferred.indexOf(a.key), j = preferred.indexOf(b.key);
        return (i < 0 ? 999 : i) - (j < 0 ? 999 : j);
      })
    : available;
}

// Only existing functional destinations are eligible: do not turn design ideas
// into new routes without an accompanying API, permission and data contract.
export const STAFF_MODULE_GROUPS: ModuleGroup[] = ["Operations", "Commercial", "Workforce", "Tools", "Account"];
export type StaffModuleGrant = { key: string; view: boolean };
export function visibleStaffModules(modules: RoleModule[], grants?: readonly StaffModuleGrant[]) {
  const allowed = new Set(grants?.filter(grant => grant.view).map(grant => grant.key));
  return modules.filter(module => {
    const permission = STAFF_MODULE_PERMISSIONS[module.key];
    return !permission || allowed.has(permission);
  });
}

export function StaffModuleDirectory({
  role, title = "Your modules", searchable = false, scope = "all", category,
}: { role?: string | null; title?: string; searchable?: boolean; scope?: StaffModuleScope; category?: ModuleGroup }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const [allowed, setAllowed] = useState<StaffModuleGrant[] | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ModuleGroup | "All">("All");
  const staffRole = STAFF_ROLES.find(value => value === role);

  useFocusEffect(useCallback(() => {
    if (!staffRole || !token) {
      setAllowed([]);
      setPermissionError(true);
      return;
    }
    let active = true;
    setAllowed(null);
    setPermissionError(false);
    apiGet<{ permissions: StaffModuleGrant[] }>("/staff/module-permissions", token)
      .then(result => {
        if (active) setAllowed(result.permissions);
      })
      .catch(() => {
        if (active) {
          setAllowed([]);
          setPermissionError(true);
        }
      });
    return () => { active = false; };
  }, [token, staffRole]));

  const selectedGroup = category ?? group;
  const allVisible = useMemo(() => visibleStaffModules(staffModulesForScope(role, scope), allowed ?? undefined)
    .filter(module => !category || module.group === category), [role, scope, allowed, category]);
  const needle = query.trim().toLowerCase();
  const modules = allVisible.filter(module => (selectedGroup === "All" || module.group === selectedGroup)
    && (!needle || (module.label + " " + module.description).toLowerCase().includes(needle)));

  // Tablet/desktop gets additional columns; on phones every card has enough
  // width for its label and maintains a 44pt+ touch target.
  const cols = width >= 950 ? 5 : width >= 680 ? 4 : width >= 470 ? 3 : 2;
  const contentWidth = Math.max(0, Math.min(width, 980) - 2 * spacing.lg);
  const cardWidth = Math.max(0, (contentWidth - (cols - 1) * 9) / cols);

  if (!staffRole) return null;
  return (
    <View testID="role-module-directory" style={styles.wrapper}>
      {!category ? <View style={styles.heading}>
        <View style={{ flex: 1, gap: 3 }}>
          <AppText variant="heading">{title}</AppText>
          <AppText variant="caption">{allVisible.length} available destinations · access controlled by your plant</AppText>
        </View>
        <View style={[styles.count, { backgroundColor: colors.brandSoft }]}>
          <AppText style={{ color: colors.onBrandSoft, fontFamily: fonts.bold, fontSize: 13 }}>{allVisible.length}</AppText>
        </View>
      </View> : null}

      {searchable ? (
        <>
          <View style={[styles.search, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <VectorSymbol name="search" size={18} color={colors.onSurfaceTertiary} />
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
          {!category ? <View style={styles.filters}>
            {(["All", ...STAFF_MODULE_GROUPS] as const).map(g => {
              if (g !== "All" && !allVisible.some(m => m.group === g)) return null;
              const selected = group === g;
              return (
                <Pressable key={g} testID={"staff-group-" + g.toLowerCase()}
                  accessibilityRole="button" accessibilityState={{ selected }}
                  onPress={() => setGroup(g)}
                  style={[styles.filter, { backgroundColor: selected ? colors.surfaceTertiary : colors.surfaceSecondary, borderColor: selected ? colors.controlOutline : colors.divider }]}>
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: selected ? colors.accentText : colors.onSurface }}>{g}</AppText>
                </Pressable>
              );
            })}
          </View> : null}
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
      {STAFF_MODULE_GROUPS.map(moduleGroup => {
        const entries = modules.filter(m => m.group === moduleGroup);
        if (!entries.length) return null;
        return (
          <View key={moduleGroup} style={{ gap: spacing.sm }}>
            {!category ? <AppText variant="label">{moduleGroup}</AppText> : null}
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
                      borderColor: colors.divider,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}>
                  {module.symbol ? <IconTile symbol={module.symbol} width={37} /> : <IconTile icon={module.icon} width={37} />}
                  <AppText style={[styles.cardTitle, { color: colors.onSurface }]}>{module.label}</AppText>
                  <AppText style={[styles.cardDescription, { color: colors.onSurfaceTertiary }]}>{module.description}</AppText>
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  card: { minHeight: 112, maxWidth: "100%", borderWidth: 1, borderRadius: 16, padding: 7, alignItems: "center", justifyContent: "center", gap: 3 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 12, textAlign: "center", lineHeight: 16 },
  cardDescription: { fontFamily: fonts.regular, fontSize: 10, textAlign: "center", lineHeight: 14 },
  search: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: { borderRadius: radius.pill, borderWidth: 1, minHeight: 38, paddingHorizontal: 13, paddingVertical: 10, justifyContent: "center" },
  notice: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: radius.md, padding: 12 },
});
