import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { fonts } from "@/src/theme/tokens";
import type { RoleModule } from "@/src/navigation/moduleCatalog";
import { ownerDestination } from "./modules";

export function useOwnerPalette() {
  const { scheme } = useTheme();
  const dark = scheme === "dark";
  return { dark, accent: "#FF6B00", pressed: "#E65F00", text: dark ? "#F4F6FA" : "#141B28", muted: dark ? "#B7C2D2" : "#59677D", canvas: dark ? "#0E1116" : "#F7F6F2", glass: dark ? "rgba(28,34,43,0.88)" : "rgba(255,255,255,0.80)", border: dark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.94)" };
}
export function useOwnerBottomSpace() { return 112 + useSafeAreaInsets().bottom; }
export function OwnerGlass({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = useOwnerPalette();
  return <View style={[ui.glass, { backgroundColor: p.glass, borderColor: p.border }, style]}>{children}</View>;
}
export function OwnerHeader() {
  const { toggle, scheme } = useTheme();
  const p = useOwnerPalette();
  const router = useRouter();
  const { data, refetch } = useGet<{ unread: number }>("/notifications");
  // Refresh unread data when returning from notification details without polling.
  const focusedOnce = React.useRef(false);
  useFocusEffect(React.useCallback(() => { if (focusedOnce.current) void refetch(); focusedOnce.current = true; }, [refetch]));
  return <View style={ui.header}>
    <VectorSymbol name="plant-dashboard" size={42} />
    <View style={{ flex: 1, minWidth: 0 }}><AppText style={{ fontSize: 10, color: p.text }}>Plant Owner</AppText><AppText numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 17, color: p.text }}>TrackMyRMC</AppText></View>
    <Pressable testID="owner-theme-toggle" accessibilityRole="button" accessibilityLabel={`Switch to ${scheme === "dark" ? "light" : "dark"} theme`} onPress={toggle} style={[ui.headerButton, { backgroundColor: p.glass }]}><Ionicons name={scheme === "dark" ? "moon-outline" : "sunny-outline"} size={21} color={scheme === "dark" ? p.text : p.accent} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${data ? `, ${data.unread} unread` : ""}`} onPress={() => router.push("/notifications")} style={[ui.headerButton, { backgroundColor: p.glass }]}><Ionicons name="notifications-outline" size={23} color={p.text} />{data && data.unread > 0 ? <View style={ui.badge}><AppText style={{ color: "white", fontSize: 9 }}>{data.unread > 99 ? "99+" : data.unread}</AppText></View> : null}</Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Help and support" onPress={() => router.push("/support")} style={[ui.headerButton, { backgroundColor: p.glass }]}><Ionicons name="help-circle-outline" size={25} color={p.text} /></Pressable>
  </View>;
}
export function OwnerFrame({ children, title, subtitle }: { children: React.ReactNode; title?: string; subtitle?: string }) {
  const p = useOwnerPalette();
  const insets = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: p.canvas }}>
    {/* Metro registers bundled image assets through static require calls. */}
    <Image source={p.dark ? require("../../assets/images/Background Dark Theme.png") : require("../../assets/images/Background Light Theme.png")} resizeMode="cover" style={[StyleSheet.absoluteFill, { width: "100%", height: "100%", opacity: 0.35 }]} />
    <View style={[ui.container, { paddingTop: insets.top }]}>
      <OwnerHeader />
      {title ? <View style={ui.title}><AppText style={{ fontFamily: fonts.bold, fontSize: 27, color: p.text }}>{title}</AppText><AppText style={{ fontSize: 12, lineHeight: 18, color: p.muted }}>{subtitle}</AppText></View> : null}
      {children}
    </View>
  </View>;
}
export function OwnerList({ children }: { children: React.ReactNode }) {
  const bottom = useOwnerBottomSpace();
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[ui.content, { paddingBottom: bottom }]}>{children}</ScrollView>;
}
export function OwnerModuleRow({ module }: { module: RoleModule }) {
  const p = useOwnerPalette();
  const router = useRouter();
  return <Pressable testID={`role-module-${module.key}`} accessibilityRole="button" accessibilityLabel={module.label} onPress={() => router.push(ownerDestination(module))} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
    <OwnerGlass style={ui.moduleRow}>
      {module.symbol ? <VectorSymbol name={module.symbol} size={44} warmAccent /> : <Ionicons name={module.icon} size={30} color={p.accent} />}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><AppText style={{ fontFamily: fonts.semibold, fontSize: 14, color: p.text }}>{module.label}</AppText><AppText numberOfLines={1} style={{ fontSize: 11, color: p.muted }}>{module.description}</AppText></View>
      <Ionicons name="chevron-forward" size={17} color={p.text} />
    </OwnerGlass>
  </Pressable>;
}
export const ui = StyleSheet.create({
  container: { flex: 1, width: "100%", maxWidth: 820, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 17 },
  headerButton: { width: 38, height: 40, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 0, right: 0, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: "#D62C20", alignItems: "center", justifyContent: "center" },
  title: { paddingHorizontal: 18, paddingBottom: 16, gap: 3 },
  content: { paddingHorizontal: 16, gap: 8 },
  glass: { borderWidth: 1, borderRadius: 18, shadowColor: "#816044", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 1 },
  moduleRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 60, paddingHorizontal: 10, paddingVertical: 6 },
  section: { fontFamily: fonts.semibold, fontSize: 14, marginTop: 10, marginBottom: 2 },
});
