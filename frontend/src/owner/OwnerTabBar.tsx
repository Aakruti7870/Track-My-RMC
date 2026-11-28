import React, { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { tabVectorSymbol } from "@/src/navigation/vectorSymbolAssignments";
import { IconTile } from "@/src/components/IconTile";
import type { TabDef } from "@/src/components/GlassTabBar";
import { OwnerGlass, useOwnerPalette } from "./OwnerUI";
import { OwnerRmcCosting } from "./OwnerRmcCosting";
import { usePlantWorkspace } from "./PlantOperations";
import { pressRoleTab, type RoleTabState, type RoleTabNavigation } from "@/src/navigation/pressRoleTab";
const BUSINESS_ROUTES = new Set(["orders", "billing", "quotation-requests", "provisional-requests"]);

type Props = { state: RoleTabState; navigation: RoleTabNavigation; tabs: TabDef[] };

const ACTIONS: { label: string; symbol: VectorSymbolName; icon: keyof typeof Ionicons.glyphMap; route: Href }[] = [
  { label: "Review Pending Orders", symbol: "plant-orders", icon: "time-outline", route: { pathname: "/owner/orders", params: { status: "pending", today: "" } } },
  { label: "Open Production & Dispatch", symbol: "material-consumption", icon: "bus-outline", route: { pathname: "/owner/orders", params: { status: "processing", today: "" } } },
  { label: "Mixer & Driver Assignment", symbol: "driver-assignment", icon: "people-outline", route: { pathname: "/owner/orders", params: { status: "processing", today: "" } } },
  { label: "Open Inventory", symbol: "material-inventory", icon: "cube-outline", route: "/business/inventory" },
  { label: "Plant Quotations", symbol: "quotations", icon: "document-text-outline", route: "/business/quotations" },
  { label: "Incident / SOS Register", symbol: "incident-register", icon: "warning-outline", route: "/owner/incidents" },
];

export function OwnerTabBar({ state, navigation, tabs }: Props) {
  const p = useOwnerPalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { plants, plant, setSelection, loading: plantsLoading, error: plantsError, reload: reloadPlants } = usePlantWorkspace();

  function tabItem(tab: TabDef) {
    const route = state.routes.find(route => route.name === tab.name); if (!route) return null;
    const active = state.routes[state.index];
    const selected = active?.key === route.key || (tab.name === "business" && BUSINESS_ROUTES.has(active?.name));
    const symbol = tabVectorSymbol(tab.label, "plant_owner");
    return <Pressable key={tab.name} testID={`tab-${tab.label.toLowerCase()}`} accessibilityRole="tab" accessibilityLabel={`${tab.label} tab`} accessibilityState={{ selected }} aria-selected={selected} onPress={() => pressRoleTab(state, navigation, route)} style={{ flex: 1, minWidth: 0, minHeight: 65, alignItems: "center", justifyContent: "center", gap: 4 }}>{symbol ? <VectorSymbol name={symbol} size={30} color={selected ? p.accent : p.muted} active={selected} /> : <Ionicons name={selected ? tab.active : tab.icon} size={30} color={selected ? p.accent : p.muted} />}<AppText numberOfLines={1} style={{ fontSize: 10, color: selected ? p.accent : p.muted }}>{tab.label}</AppText></Pressable>;
  }

  return <>
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}><OwnerGlass highlighted={false} style={{ width: "100%", maxWidth: 820, alignSelf: "center", borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: Platform.OS === "web" ? 8 : Math.max(insets.bottom, 8), paddingTop: 3, flexDirection: "row", alignItems: "center" }}>
      {tabs.slice(0, 2).map(tabItem)}
      <View style={{ width: 72, alignItems: "center", gap: 3, marginTop: -20 }}>
        <View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: `${p.accent}2E`, borderWidth: 1.5, borderColor: `${p.accent}88`, alignItems: "center", justifyContent: "center", shadowColor: p.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.72, shadowRadius: 14, elevation: 10 }}>
          <Pressable testID="tab-quick-actions" accessibilityRole="button" accessibilityLabel="Open RMC Price Calculator" onPress={() => setOpen(true)} style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 28, backgroundColor: pressed ? p.pressed : p.accent, borderWidth: 2, borderColor: "#FFF3E0", alignItems: "center", justifyContent: "center" })}>
            <VectorSymbol name="invoice-editor" size={26} color="#14181F" />
          </Pressable>
        </View>
        <AppText numberOfLines={1} style={{ fontSize: 10, fontWeight: "700", color: p.accent }}>RMC Price</AppText>
      </View>
      {tabs.slice(2).map(tabItem)}
    </OwnerGlass></View>

    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.52)" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss RMC Price Calculator" onPress={() => setOpen(false)} style={{ flex: 1 }} />
        <OwnerGlass style={{ maxWidth: 640, width: "100%", maxHeight: "88%", alignSelf: "center", paddingBottom: insets.bottom + 16, paddingHorizontal: 14, paddingTop: 16, backgroundColor: p.canvas }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6, marginBottom: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: `${p.accent}24`, borderWidth: 1, borderColor: `${p.accent}77`, alignItems: "center", justifyContent: "center" }}>
                <VectorSymbol name="invoice-editor" size={22} color={p.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">RMC Price Calculator</AppText>
                <AppText variant="caption">Mix design, purchase rates, diesel & odometer costing</AppText>
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close RMC Price Calculator" onPress={() => setOpen(false)} style={{ padding: 10 }}>
              <VectorSymbol name="close" size={24} color={p.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 18, gap: 10 }}>
            {plants.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 4 }}>
                {plants.map(item => (
                  <Pressable key={item.id} accessibilityRole="button" onPress={() => setSelection(item.id)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: item.id === plant?.id ? p.accent : p.border, backgroundColor: item.id === plant?.id ? `${p.accent}22` : p.canvas }}>
                    <AppText style={{ fontSize: 12, fontWeight: item.id === plant?.id ? "700" : "500", color: item.id === plant?.id ? p.accent : p.text }}>{item.name}</AppText>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {plantsLoading ? <AppText variant="caption" center>Loading plant workspace…</AppText>
              : plantsError ? <View style={{ padding: 12, gap: 8 }}><AppText variant="bodyMuted" center>{plantsError}</AppText><Button label="Retry" variant="outline" onPress={() => void reloadPlants()} /></View>
              : plant?.id ? <OwnerRmcCosting plantId={plant.id} defaultOpen />
              : <AppText variant="bodyMuted" center>No active plant found for this account.</AppText>}

            <View style={{ paddingHorizontal: 12, paddingTop: 8, gap: 8 }}>
              <AppText variant="label" style={{ color: p.muted }}>Quick Actions</AppText>
              {ACTIONS.map(action => (
                <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} onPress={() => { setOpen(false); router.push(action.route); }}>
                  <OwnerGlass style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                    <IconTile symbol={action.symbol} homeShortcut />
                    <AppText style={{ flex: 1, fontSize: 12, color: p.text }}>{action.label}</AppText>
                    <VectorSymbol name="chevron-right" size={17} color={p.muted} />
                  </OwnerGlass>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </OwnerGlass>
      </View>
    </Modal>
  </>;
}
