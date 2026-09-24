import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { AppText } from "@/src/components/ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { control, fonts, radius, spacing } from "@/src/theme/tokens";
import type { TabDef } from "@/src/components/GlassTabBar";

type Props = {
  visible: boolean;
  onClose: () => void;
  tabs: TabDef[];
  role?: string | null;
  navigation: any;
};

const ROLE_LABELS: Record<string, string> = {
  customer: "Customer",
  driver: "Driver",
  plant_owner: "Plant Owner",
  admin: "Admin",
  dispatcher: "Dispatcher",
  operator: "Operator",
  supervisor: "Supervisor",
  accountant: "Accounts",
  quality_engineer: "Quality",
  fleet_manager: "Fleet",
  store_manager: "Store",
};

export function QuickActionHub({ visible, onClose, tabs, role, navigation }: Props) {
  const { colors, scheme } = useTheme();
  const roleLabel = ROLE_LABELS[role || ""] || "Quick";

  const runAction = (tab: TabDef) => {
    void Haptics.selectionAsync();
    onClose();
    navigation.navigate(tab.name);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.overlay, { backgroundColor: colors.scrim }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close quick actions"
        />
        <BlurView
          intensity={scheme === "dark" ? 70 : 90}
          tint={scheme === "dark" ? "dark" : "light"}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.isDark ? "rgba(18,20,22,0.97)" : "rgba(255,255,255,0.97)",
              borderColor: colors.isDark ? "rgba(255,255,255,0.11)" : "rgba(17,19,21,0.09)",
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <AppText variant="eyebrow">{roleLabel} COMMANDS</AppText>
              <AppText variant="sectionTitle">Quick Actions</AppText>
              <AppText variant="bodyMuted">Jump directly to the task you need without hunting through menus.</AppText>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close quick actions"
              hitSlop={6}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: pressed ? colors.brandSoft : colors.surfaceTertiary,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="close" size={20} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.grid}>
            {tabs.map((tab, index) => (
              <Pressable
                key={tab.name}
                onPress={() => runAction(tab)}
                accessibilityRole="button"
                accessibilityLabel={`${tab.label} quick action`}
                accessibilityHint={`Open ${tab.label}`}
                style={({ pressed }) => [
                  styles.action,
                  {
                    backgroundColor: pressed ? colors.brandSoft : colors.surfaceSecondary,
                    borderColor: pressed ? colors.brand + "4A" : colors.border,
                    transform: [{ scale: pressed ? 0.985 : 1 }],
                  },
                ]}
              >
                <View style={styles.actionTopRow}>
                  <View style={[styles.actionIcon, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "28" }]}>
                    <Ionicons name={tab.active} size={23} color={colors.brand} />
                  </View>
                  <AppText style={[styles.index, { color: colors.onSurfaceTertiary }]}>{String(index + 1).padStart(2, "0")}</AppText>
                </View>
                <View style={styles.actionCopy}>
                  <AppText style={[styles.actionLabel, { color: colors.onSurface }]} numberOfLines={1}>{tab.label}</AppText>
                  <Ionicons name="arrow-forward" size={16} color={colors.onSurfaceTertiary} />
                </View>
              </Pressable>
            ))}
          </View>
        </BlurView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  sheet: {
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.26,
    shadowRadius: 32,
    elevation: 20,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.md,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  headingCopy: { flex: 1, paddingRight: spacing.md, gap: 4 },
  closeButton: {
    width: control.iconButton,
    height: control.iconButton,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.md,
  },
  action: {
    width: "48%",
    minHeight: 118,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    justifyContent: "space-between",
  },
  actionTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  actionIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  index: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.6 },
  actionCopy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  actionLabel: { fontFamily: fonts.semibold, fontSize: 14, flex: 1 },
});
