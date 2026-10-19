import React, { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/src/components/ui/AppText";
import type { TabDef } from "@/src/components/GlassTabBar";
import { OwnerGlass, useOwnerPalette } from "./OwnerUI";
type Props = { state: { index: number; routes: { key: string; name: string }[] }; navigation: { emit: (event: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean }; navigate: (name: string) => void }; tabs: TabDef[] };
const ACTIONS: { label: string; icon: keyof typeof Ionicons.glyphMap; route: Href }[] = [
  { label: "Review Pending Orders", icon: "time-outline", route: { pathname: "/owner/orders", params: { status: "pending", today: "" } } },
  { label: "Open Production & Dispatch", icon: "bus-outline", route: { pathname: "/owner/orders", params: { status: "processing", today: "" } } },
  { label: "Open Inventory", icon: "cube-outline", route: "/business/inventory" },
  { label: "Plant Quotations", icon: "document-text-outline", route: "/business/quotations" },
  { label: "Incident / SOS Register", icon: "warning-outline", route: "/owner/incidents" },
];
export function OwnerTabBar({ state, navigation, tabs }: Props) {
  const p = useOwnerPalette(); const insets = useSafeAreaInsets(); const router = useRouter(); const [open, setOpen] = useState(false);
  function tabItem(tab: TabDef) {
    const route = state.routes.find(route => route.name === tab.name); if (!route) return null;
    const selected = state.routes[state.index]?.key === route.key;
    return <Pressable key={tab.name} testID={`tab-${tab.label.toLowerCase()}`} accessibilityRole="tab" accessibilityLabel={`${tab.label} tab`} accessibilityState={{ selected }} onPress={() => { const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true }); if (!event.defaultPrevented) navigation.navigate(tab.name); }} style={{ flex: 1, minWidth: 0, minHeight: 65, alignItems: "center", justifyContent: "center", gap: 4 }}><Ionicons name={selected ? tab.active : tab.icon} size={30} color={selected ? p.accent : p.muted} /><AppText numberOfLines={1} style={{ fontSize: 10, color: selected ? p.accent : p.muted }}>{tab.label}</AppText></Pressable>;
  }
  return <>
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}><OwnerGlass style={{ width: "100%", maxWidth: 820, alignSelf: "center", borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: Math.max(insets.bottom, 8), paddingTop: 3, backgroundColor: p.dark ? "rgba(24,30,39,0.97)" : "rgba(255,255,255,0.97)", flexDirection: "row", alignItems: "center" }}>
      {tabs.slice(0, 2).map(tabItem)}
      <View style={{ width: 66, alignItems: "center", gap: 3, marginTop: -16 }}><Pressable testID="tab-quick-actions" accessibilityRole="button" accessibilityLabel="Open quick actions" onPress={() => setOpen(true)} style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 28, backgroundColor: pressed ? p.pressed : p.accent, borderWidth: 3, borderColor: p.border, alignItems: "center", justifyContent: "center", shadowColor: p.accent, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 })}><Ionicons name="add" size={32} color="white" /></Pressable><AppText style={{ fontSize: 10, color: p.accent }}>Quick</AppText></View>
      {tabs.slice(2).map(tabItem)}
    </OwnerGlass></View>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}><View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.48)" }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss quick actions" onPress={() => setOpen(false)} style={{ flex: 1 }} />
      <OwnerGlass style={{ maxWidth: 600, width: "100%", maxHeight: "85%", alignSelf: "center", paddingBottom: insets.bottom + 16, paddingHorizontal: 18, paddingTop: 18, backgroundColor: p.canvas }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><AppText variant="heading">Quick Actions</AppText><Pressable accessibilityRole="button" accessibilityLabel="Close quick actions" onPress={() => setOpen(false)} style={{ padding: 12 }}><Ionicons name="close" size={25} color={p.text} /></Pressable></View>
        <ScrollView contentContainerStyle={{ gap: 8 }}>{ACTIONS.map(action => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} onPress={() => { setOpen(false); router.push(action.route); }}><OwnerGlass style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 15 }}><Ionicons name={action.icon} size={24} color={p.accent} /><AppText style={{ flex: 1, fontSize: 13, color: p.text }}>{action.label}</AppText><Ionicons name="chevron-forward" size={17} color={p.muted} /></OwnerGlass></Pressable>)}</ScrollView>
      </OwnerGlass>
    </View></Modal>
  </>;
}
