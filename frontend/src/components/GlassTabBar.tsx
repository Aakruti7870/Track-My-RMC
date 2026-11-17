import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, useWindowDimensions, View, type TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { QuickActionHub } from "@/src/components/QuickActionHub";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { pressRoleTab, type RoleTabRoute, type RoleTabState, type RoleTabNavigation } from "@/src/navigation/pressRoleTab";
import { tabVectorSymbol } from "@/src/navigation/vectorSymbolAssignments";
import { control, fonts, radius, spacing } from "@/src/theme/tokens";
import { getThemedCanvasColor } from "@/src/theme/sceneBackground";

export type TabDef = {
  name: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: keyof typeof Ionicons.glyphMap;
};

const tabLabelWrapping = Platform.select<TextStyle>({
  web: { overflowWrap: "anywhere" } as TextStyle,
  default: {},
});

type GlassTabBarProps = {
  state: RoleTabState;
  navigation: RoleTabNavigation;
  tabs: TabDef[];
  centerLabel?: string;
  onCenterPress?: () => void;
  hideCenterAction?: boolean;
};

export function GlassTabBar({ state, navigation, tabs, centerLabel = "Quick", onCenterPress, hideCenterAction = false }: GlassTabBarProps) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const stackedTabs = !hideCenterAction && fontScale >= 1.3;
  const inFlow = hideCenterAction || stackedTabs || onCenterPress != null;
  const [hubOpen, setHubOpen] = useState(false);

  const visibleRoutes = hideCenterAction
    ? tabs.flatMap(tab => state.routes.filter(route => route.name === tab.name))
    : state.routes.filter(route => tabs.some(tab => tab.name === route.name));
  const leftRoutes = visibleRoutes.slice(0, 2);
  const rightRoutes = visibleRoutes.slice(2, 4);

  const renderTab = (route: RoleTabRoute) => {
    const tab = tabs.find((definition) => definition.name === route.name)!;
    const index = state.routes.findIndex((candidate) => candidate.key === route.key);
    const focused = state.index === index;
    const symbol = tabVectorSymbol(tab.label, user?.role);
    const selectedInk = colors.accentText;
    const ink = focused ? selectedInk : colors.onSurfaceTertiary;

    return (
      <Pressable
        key={route.key}
        testID={`tab-${tab.label.toLowerCase()}`}
        style={({ pressed }) => [styles.item, stackedTabs && styles.stackedItem, { opacity: pressed ? 0.76 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        aria-selected={focused}
        accessibilityLabel={`${tab.label} tab`}
        hitSlop={4}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => undefined);
          pressRoleTab(state, navigation, route);
        }}
      >
        <View style={[styles.activeIndicator, { backgroundColor: focused ? colors.brand : "transparent" }]} />
        {symbol ? <VectorSymbol name={symbol} color={ink} active={focused} /> : <Ionicons name={focused ? tab.active : tab.icon} size={24} color={ink} />}
        <AppText
          maxFontSizeMultiplier={0}
          style={[tabLabelWrapping, {
            fontFamily: focused ? fonts.semibold : fonts.medium,
            fontSize: 11,
            lineHeight: 15,
            color: ink,
            textAlign: "center",
            maxWidth: "100%",
          }]}
        >
          {tab.label}
        </AppText>
      </Pressable>
    );
  };

  return (
    <>
      <View pointerEvents="box-none" style={[!inFlow && styles.wrap, { paddingBottom: Platform.OS === "web" ? 0 : insets.bottom, backgroundColor: getThemedCanvasColor(colors) }]}>
        <View
          testID="app-tab-bar"
          style={[
            styles.bar,
            {
              borderColor: colors.divider,
              backgroundColor: colors.surfaceSecondary,
            },
          ]}
        >
          {hideCenterAction ? visibleRoutes.map(renderTab) : <>
            <View style={[styles.tabSide, stackedTabs && styles.stackedSide]}>{leftRoutes.map(renderTab)}</View>

            <View style={[styles.centerSlot, inFlow && styles.centerInFlow]}>
              <Pressable
                testID={onCenterPress ? "tab-new-order" : "tab-quick-actions"}
                accessibilityRole="button"
                accessibilityLabel={onCenterPress ? "New order" : `Open ${centerLabel.toLowerCase()} actions`}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                  if (onCenterPress) onCenterPress();
                  else setHubOpen(true);
                }}
                style={({ pressed }) => [
                  styles.centerButton,
                  {
                    backgroundColor: pressed ? colors.brandPressed : colors.brand,
                    borderColor: colors.surfaceSecondary,
                    transform: [{ scale: pressed ? 0.93 : 1 }],
                  },
                ]}
              >
                {centerLabel === "New" ? <VectorSymbol name="new-order" size={26} color={colors.onBrand} /> : <Ionicons name="add" size={26} color={colors.onBrand} />}
              </Pressable>
              <AppText maxFontSizeMultiplier={0} style={[styles.centerLabel, { color: colors.onSurfaceTertiary }]}>{centerLabel}</AppText>
            </View>

            <View style={[styles.tabSide, stackedTabs && styles.stackedSide]}>{rightRoutes.map(renderTab)}</View>
          </>}
        </View>
      </View>

      {!hideCenterAction && !onCenterPress ? <QuickActionHub visible={hubOpen} onClose={() => setHubOpen(false)} tabs={tabs} role={user?.role} onSelect={(name) => {
        const route = state.routes.find(item => item.name === name);
        if (route) pressRoleTab(state, navigation, route);
      }} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  tabSide: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-end" },
  stackedSide: { alignItems: "stretch", flexDirection: "column" },
  item: { flex: 1, minWidth: 0, minHeight: 58, alignItems: "center", justifyContent: "flex-end", gap: 3, paddingVertical: 2 },
  stackedItem: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  activeIndicator: { width: 18, height: 3, borderRadius: radius.pill, marginBottom: 1 },
  centerSlot: { width: 72, minHeight: 60, alignItems: "center", justifyContent: "flex-end", marginTop: -30 },
  centerInFlow: { marginTop: 0 },
  centerButton: {
    width: 58,
    height: 58,
    minWidth: control.minTouch,
    minHeight: control.minTouch,
    borderRadius: radius.pill,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  centerLabel: { marginTop: 4, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, textAlign: "center" },
});
