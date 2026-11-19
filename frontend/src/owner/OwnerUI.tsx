import { screenOverflow } from "@/src/theme/sceneBackground";
import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/theme/ThemeProvider";
import { OperationalHomeTopBar } from "@/src/components/OperationalHomeTopBar";
import { AppText } from "@/src/components/ui/AppText";
import { CardHighlight } from "@/src/components/ui/CardHighlight";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { fonts } from "@/src/theme/tokens";
import type { RoleModule } from "@/src/navigation/moduleCatalog";
import { ownerDestination } from "./modules";

export function useOwnerPalette() {
  const { colors } = useTheme();
  const dark = colors.isDark;
  return { dark, accent: colors.brand, pressed: colors.brandPressed, onAccent: colors.onBrand, text: colors.onSurface, muted: colors.onSurfaceTertiary, canvas: colors.canvas, panel: colors.surfaceSecondary, border: colors.divider };
}
export function useOwnerBottomSpace() { return 112 + useSafeAreaInsets().bottom; }
export function OwnerGlass({ children, style, testID, highlighted = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string; highlighted?: boolean }) {
  const p = useOwnerPalette();
  const customRadius = StyleSheet.flatten(style)?.borderRadius;
  return <View testID={testID} style={[ui.panel, { backgroundColor: p.panel, borderColor: p.border }, style]}>
    {highlighted ? <CardHighlight radius={typeof customRadius === "number" ? customRadius : 12} /> : null}
    {children}
  </View>;
}
export function OwnerHeader() { return <OperationalHomeTopBar />; }
export function OwnerFrame({ children, title, subtitle, matte = false }: { children: React.ReactNode; title?: string; subtitle?: string; matte?: boolean }) {
  const p = useOwnerPalette();
  const insets = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: p.canvas, overflow: screenOverflow }}>
    {/* Metro registers bundled image assets through static require calls. */}
    {!matte ? <Image source={p.dark ? require("../../assets/images/Background Dark Theme.webp") : require("../../assets/images/Background Light Theme.webp")} resizeMode="cover" style={[StyleSheet.absoluteFill, { width: "100%", height: "100%", opacity: 0.15 }]} /> : null}
    <View style={[ui.container, { paddingTop: insets.top }]}>
      <OwnerHeader />
      {title ? <View style={ui.title}><AppText style={{ fontFamily: fonts.bold, fontSize: 27, color: p.text }}>{title}</AppText><AppText style={{ fontSize: 12, lineHeight: 18, color: p.muted }}>{subtitle}</AppText></View> : null}
      {children}
    </View>
  </View>;
}
export function OwnerList({ children, reserveNavigation = false }: { children: React.ReactNode; reserveNavigation?: boolean }) {
  const bottom = useOwnerBottomSpace();
  return <ScrollView showsVerticalScrollIndicator={false}
    style={reserveNavigation ? { minHeight: 0, marginBottom: bottom } : undefined}
    contentContainerStyle={[ui.content, { paddingBottom: reserveNavigation ? 12 : bottom }]}>
    {children}
  </ScrollView>;
}
export function OwnerModuleRow({ module, compact = false }: { module: RoleModule; compact?: boolean }) {
  const p = useOwnerPalette();
  const router = useRouter();
  return <Pressable testID={`role-module-${module.key}`} accessibilityRole="button" accessibilityLabel={module.label} onPress={() => router.push(ownerDestination(module))} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
    <OwnerGlass style={[ui.moduleRow, compact && { minHeight: 50, paddingVertical: 5 }]}>
      {module.symbol ? <IconTile symbol={module.symbol} width={compact ? 38 : 44} /> : <IconTile icon={module.icon} width={compact ? 38 : 44} />}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><AppText style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: p.text }}>{module.label}</AppText><AppText numberOfLines={1} style={{ fontSize: 11, lineHeight: 15, color: p.muted }}>{module.description}</AppText></View>
      <Ionicons name="chevron-forward" size={17} color={p.text} />
    </OwnerGlass>
  </Pressable>;
}
export function OwnerLinkRow({ title, route, symbol, testID, divider = false }: {
  title: string; route: Href; symbol?: VectorSymbolName; testID?: string; divider?: boolean;
}) {
  const p = useOwnerPalette();
  const router = useRouter();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title}
    onPress={() => router.push(route)}
    style={({ pressed }) => [ui.linkRow, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border },
      { opacity: pressed ? 0.72 : 1 }]}>
    {symbol ? <VectorSymbol name={symbol} size={23} color={p.text} /> : null}
    <AppText style={ui.linkLabel}>{title}</AppText>
    <VectorSymbol name="chevron-right" size={17} color={p.muted} />
  </Pressable>;
}
export const ui = StyleSheet.create({
  container: { flex: 1, width: "100%", maxWidth: 820, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 17 },
  headerButton: { width: 38, height: 40, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 0, right: 0, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: "#D62C20", alignItems: "center", justifyContent: "center" },
  title: { paddingHorizontal: 18, paddingBottom: 16, gap: 3 },
  content: { paddingHorizontal: 16, gap: 8 },
  panel: { borderWidth: 1, borderRadius: 12 },
  group: { overflow: "hidden" },
  groupHeading: { paddingHorizontal: 13, paddingVertical: 8, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  groupRows: { paddingHorizontal: 10 },
  linkRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4, paddingVertical: 6 },
  linkLabel: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  moduleRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 60, paddingHorizontal: 10, paddingVertical: 6 },
  section: { fontFamily: fonts.semibold, fontSize: 14, marginTop: 10, marginBottom: 2 },
});
