import React, { useRef, useState } from "react";
import { Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { ActiveTransitMixerCard } from "@/src/components/ActiveTransitMixerCard";
import { CustomerHomeHeader } from "@/src/components/customer/CustomerHomeHeader";
import { HomeCarousel } from "@/src/components/HomeCarousel";
import { HomeScroll } from "@/src/components/HomeScroll";
import { KycBanner } from "@/src/components/KycBanner";
import { ErrorView } from "@/src/components/StateViews";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import type { VectorSymbolName } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { AppText } from "@/src/components/ui/AppText";
import type { OrderData } from "@/src/components/OrderCard";
import { useGet } from "@/src/hooks/useApi";
import { enquiryRoute, materialPreview, moreMaterials, morePlanning, planningPreview, type HomeLink } from "@/src/navigation/customerHome";
import { screenOverflow } from "@/src/theme/sceneBackground";
import { customerHomeSizes, fonts, homeArtwork } from "@/src/theme/tokens";
import { useTheme } from "@/src/theme/ThemeProvider";

type HomeData = { kyc_status: string; active_order: OrderData | null; recent_orders: OrderData[] };
type Directory = "planning" | "materials";
const ACTIONS = [
  { key: "new", label: "New Order", symbol: "new-order" },
  { key: "track", label: "Track Order", symbol: "live-order-tracking" },
  { key: "plants", label: "Nearby Plants", symbol: "nearby-rmc-plants" },
  { key: "orders", label: "My Orders", symbol: "my-orders" },
] as const;

export default function CustomerHome() {
  const { colors, reduceMotion } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const size = customerHomeSizes(width, Platform.OS);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const { data, error, refetch, reload } = useGet<HomeData>("/customer/home");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const directoryTrigger = useRef<View | null>(null);
  const planningTrigger = useRef<View>(null);
  const materialsTrigger = useRef<View>(null);
  const cardWidth = Math.min(Math.max(0, width - 24), 839);
  const tileWidth = (cardWidth - 20) / fontScale >= 250 ? "24%" : "49%";
  const heading = [styles.heading, { color: colors.onSurface, fontSize: size.headerSize, lineHeight: size.headerLine }];
  const panel = [styles.panel, { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider }];
  const order = data?.active_order;

  function openAction(key: typeof ACTIONS[number]["key"]) {
    switch (key) {
      case "new": router.push("/new-order"); return;
      case "plants": router.push("/customer/plants"); return;
      case "track":
        if (order) {
          router.push({ pathname: "/track/[id]", params: { id: order.id } });
          return;
        }
        break;
      case "orders": break;
    }
    router.push("/customer/orders");
  }

  function openDirectory(next: Directory) {
    directoryTrigger.current = next === "planning" ? planningTrigger.current : materialsTrigger.current;
    setDirectory(next);
  }

  function closeDirectory() {
    setDirectory(null);
    if (Platform.OS === "web") requestAnimationFrame(() => directoryTrigger.current?.focus());
  }

  function tile({ id, label, symbol, onPress, kind, seeAll }: {
    id: string; label: string; symbol: VectorSymbolName; onPress: () => void;
    kind: "quick" | "planning" | "material"; seeAll?: Directory;
  }) {
    const material = kind === "material";
    const iconSize = kind === "quick" ? size.quickSymbol : material ? size.serviceSymbol : size.toolSymbol;
    const labelSize = material ? size.serviceLabel : kind === "quick" ? size.quickLabel : size.toolLabel;
    return (
      <Pressable key={id} testID={id}
        ref={seeAll === "planning" ? planningTrigger : seeAll === "materials" ? materialsTrigger : undefined}
        accessibilityRole="button" accessibilityLabel={seeAll === "planning" ? "See all planning tools" : seeAll ? "See all materials and services" : label}
        onPress={onPress}
        style={({ pressed }) => [styles.tile, {
          width: tileWidth, minHeight: kind === "quick" ? size.quickTile : material ? 70 : 82,
          opacity: pressed ? 0.72 : 1,
        }, material && { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, borderWidth: 1, borderRadius: 10 }]}>
        <IconTile symbol={symbol} size={iconSize} width={kind === "quick" ? size.quickIconBox : 44} homeShortcut={kind === "quick"} />
        <AppText center style={[styles.label, { color: colors.onSurfaceSecondary, fontSize: labelSize, lineHeight: Math.max(16, labelSize + 3) }]}>{label}</AppText>
      </Pressable>
    );
  }

  function linkTile(item: HomeLink, kind: "planning" | "material") {
    const id = item.key === "pump-rental" ? "home-pump-rental" : (kind === "planning" ? "customer-module-" : "service-") + item.key;
    return tile({ id, label: item.label, symbol: item.symbol, kind, onPress: () => router.push(item.route) });
  }

  const directoryTitle = directory === "planning" ? "Active Projects & Planning" : "Materials & Services";

  return (
    <ThemedScreen>
      <View style={styles.root}>
        <LinearGradient pointerEvents="none" style={StyleSheet.absoluteFill}
          colors={colors.isDark ? ["#090A0F", "#07080D", "#06070C"] : ["#E9E4DE", "#ECE7E1", "#F4F1EC"]} />
        <CustomerHomeHeader onRefreshHome={refetch} />
        <HomeScroll testID="customer-home-scroll"
          backgroundColor={colors.canvas} gap={size.sectionGap} paddingHorizontal={12} paddingTop={10}
          contentContainerStyle={{ paddingBottom: size.sectionGap + insets.bottom }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.accentText} />}
          lead={<HomeCarousel style={styles.carousel} />}
          shortcuts={<View testID="home-quick-actions" style={panel}>
            <AppText accessibilityRole="header" style={heading}>Quick Access</AppText>
            <View style={styles.grid}>
              {ACTIONS.map(action => tile({ id: "action-" + action.key, label: action.label,
                symbol: action.symbol, kind: "quick", onPress: () => openAction(action.key) }))}
            </View>
            <Pressable testID="home-bulk-quote" accessibilityRole="button"
              onPress={() => router.push(enquiryRoute("bulk"))}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
              <LinearGradient colors={homeArtwork.bulkSurface} style={styles.bulk} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}>
                <IconTile symbol="quotation-requests" width={34} size={22} bulk />
                <AppText style={styles.bulkLabel}>Concrete in bulk? Get our best rate for your project.</AppText>
                <Ionicons name="chevron-forward" size={18} color="#FFF0E2" accessible={false} aria-hidden />
              </LinearGradient>
            </Pressable>
          </View>}>
          <View style={styles.group}><KycBanner status={data?.kyc_status ?? user?.kyc_status ?? "NOT_STARTED"} /></View>
          <View testID="customer-module-grid" style={panel}>
            <AppText accessibilityRole="header" style={heading}>Active Projects & Planning</AppText>
            <View style={styles.grid}>
              {planningPreview.map(item => linkTile(item, "planning"))}
              {tile({ id: "home-planning-see-all", label: "See All", symbol: "more", kind: "planning",
                seeAll: "planning", onPress: () => openDirectory("planning") })}
            </View>
          </View>
          <View testID="home-other-services" style={[styles.group, styles.grid]}>
            {materialPreview.map(item => linkTile(item, "material"))}
            {tile({ id: "home-materials-see-all", label: "See All", symbol: "more", kind: "material",
              seeAll: "materials", onPress: () => openDirectory("materials") })}
          </View>
          {error && !data ? <View style={styles.group}><ErrorView message={error} onRetry={reload} /></View> : null}
          {data ? <ActiveTransitMixerCard order={order || data.recent_orders[0] || null}
            onNewOrder={() => openAction("new")} onRefreshHome={refetch} /> : null}
        </HomeScroll>
      </View>
      <Modal visible={directory !== null} transparent animationType={reduceMotion ? "none" : "fade"}
        onRequestClose={closeDirectory} onDismiss={() => directoryTrigger.current?.focus()}>
        <View style={[styles.overlay, { backgroundColor: colors.scrim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDirectory} accessible={false} aria-hidden />
          <View accessibilityViewIsModal onAccessibilityEscape={closeDirectory} testID="home-shortcut-directory"
            style={[styles.sheet, { backgroundColor: colors.surfaceElevated, paddingBottom: Math.max(14, insets.bottom) }]}>
            <View style={styles.sheetHeader}>
              <AppText accessibilityRole="header" variant="heading" style={styles.flexCopy}>{directoryTitle}</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Close shortcuts" onPress={closeDirectory} style={styles.close}>
                <Ionicons name="close" size={24} color={colors.onSurface} accessible={false} aria-hidden />
              </Pressable>
            </View>
            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {(directory === "planning" ? morePlanning : moreMaterials).map(item => (
                <Pressable key={item.key} testID={"home-" + item.key} accessibilityRole="button" accessibilityLabel={item.label}
                  accessibilityHint={item.hint} onPress={() => { directoryTrigger.current = null; setDirectory(null); router.push(item.route); }}
                  style={({ pressed }) => [styles.directoryRow, { borderColor: colors.divider, opacity: pressed ? 0.72 : 1 }]}>
                  <IconTile symbol={item.symbol} width={36} />
                  <View style={styles.flexCopy}>
                    <AppText variant="label">{item.label}</AppText>
                    {item.hint ? <AppText variant="caption">{item.hint}</AppText> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={colors.onSurfaceTertiary} accessible={false} aria-hidden />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: screenOverflow },
  carousel: { maxWidth: 839, borderRadius: 10 },
  group: { width: "100%", maxWidth: 839, alignSelf: "center" },
  panel: { width: "100%", maxWidth: 839, alignSelf: "center", padding: 9, borderRadius: 10, borderWidth: 1, gap: 8 },
  heading: { fontFamily: fonts.bold, paddingHorizontal: 5 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 6 },
  tile: { minWidth: 0, alignItems: "center", paddingHorizontal: 2, paddingVertical: 3, gap: 4 },
  label: { fontFamily: fonts.medium, width: "100%" },
  bulk: { minHeight: 49, borderRadius: 8, padding: 8, flexDirection: "row", gap: 8, alignItems: "center" },
  bulkLabel: { flex: 1, minWidth: 0, fontFamily: fonts.semibold, color: "#FFF0E2", fontSize: 14, lineHeight: 19 },
  flexCopy: { flex: 1, minWidth: 0 },
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { alignSelf: "center", width: "100%", maxWidth: 560, maxHeight: "85%", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 14 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  directoryRow: { minHeight: 52, paddingVertical: 7, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row", alignItems: "center", gap: 10 },
});
