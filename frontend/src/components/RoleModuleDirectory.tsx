import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

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
  const modules = modulesForRole(role);

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
            <View style={{ gap: spacing.sm }}>
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
                      backgroundColor: colors.surfaceSecondary,
                      borderColor: colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
                    {module.symbol ? <VectorSymbol name={module.symbol} size={37} /> : <Ionicons name={module.icon} size={19} color={colors.brand} />}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{module.label}</AppText>
                    <AppText variant="caption" numberOfLines={2}>{module.description}</AppText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
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
  item: { flexDirection: "row", gap: spacing.md, alignItems: "center", minHeight: 68, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  icon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
