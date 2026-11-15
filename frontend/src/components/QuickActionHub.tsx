import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { AppText } from "@/src/components/ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { control, fonts, radius, spacing } from "@/src/theme/tokens";
import type { TabDef } from "@/src/components/GlassTabBar";
import { IconTile } from "@/src/components/IconTile";
import { tabVectorSymbol } from "@/src/navigation/vectorSymbolAssignments";

type Props = {
  visible: boolean;
  onClose: () => void;
  tabs: TabDef[];
  role?: string | null;
  navigation: any;
};

export function QuickActionHub({ visible, onClose, tabs, role, navigation }: Props) {
  const { colors, reduceMotion } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = width / fontScale < 330;

  const runAction = (tab: TabDef) => {
    void Haptics.selectionAsync().catch(() => undefined);
    onClose();
    navigation.navigate(tab.name);
  };

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.overlay, { backgroundColor: colors.scrim }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          aria-hidden
        />
        <ScrollView
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.sheetContent}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.divider,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <AppText variant="sectionTitle">Quick Access</AppText>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close quick access"
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
            {tabs.map(tab => {
              const symbol = tabVectorSymbol(tab.label, role);
              return (
                <Pressable
                  key={tab.name}
                  onPress={() => runAction(tab)}
                  accessibilityRole="button"
                  accessibilityLabel={`${tab.label} quick action`}
                  accessibilityHint={`Open ${tab.label}`}
                  style={({ pressed }) => [
                    styles.action,
                    singleColumn && styles.fullWidth,
                    {
                      backgroundColor: pressed ? colors.brandSoft : colors.surfaceSecondary,
                      borderColor: colors.divider,
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    },
                  ]}
                >
                  {symbol ? <IconTile symbol={symbol} width={38} /> : <IconTile icon={tab.icon} width={38} />}
                  <AppText style={[styles.actionLabel, { color: colors.onSurface }]}>{tab.label}</AppText>
                  <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
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
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: "100%",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 6,
  },
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  fullWidth: { width: "100%" },
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
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.sm,
  },
  actionLabel: { fontFamily: fonts.semibold, fontSize: 14, flex: 1 },
});
