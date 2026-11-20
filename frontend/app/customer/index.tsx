import { useCallback, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, View, type TextStyle } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { VectorSymbol } from "@/src/components/VectorSymbol";

import { CustomerHomeHeader } from "@/src/components/customer/CustomerHomeHeader";
import { HomeCarousel, type CarouselAction } from "@/src/components/HomeCarousel";
import { IconTile } from "@/src/components/IconTile";
import type { OrderData } from "@/src/components/OrderCard";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";
import { HomeCardRow } from "@/src/components/HomeCardRow";
import { useGet } from "@/src/hooks/useApi";
import type { LatLng } from "@/src/maps/geo";
import { enquiryRoute, homeShortcuts } from "@/src/navigation/customerHome";
import { useTheme } from "@/src/theme/ThemeProvider";
import { control, fonts, radius } from "@/src/theme/tokens";
import { CustomerPlantDiscovery } from "./plants";

export default function CustomerHome() {
  const { colors } = useTheme();
  const router = useRouter();
  const { data, refetch } = useGet<{ active_order: OrderData | null }>("/customer/home");
  const [showBulk, setShowBulk] = useState(false);
  const [discoveryLocation, setDiscoveryLocation] = useState<LatLng | null>(null);
  const bulkShown = useRef(false);

  useFocusEffect(useCallback(() => {
    if (bulkShown.current) return;
    bulkShown.current = true;
    setShowBulk(true);
    const timeout = setTimeout(() => setShowBulk(false), 10_000);
    const keyboard = Keyboard.addListener("keyboardDidShow", () => setShowBulk(false));
    return () => {
      clearTimeout(timeout);
      keyboard.remove();
      setShowBulk(false);
    };
  }, []));

  function openAction(action: CarouselAction) {
    switch (action) {
      case "new": router.push("/new-order"); return;
      case "plants": router.push("/customer/plants"); return;
      case "calculator": router.push("/customer/free-tools"); return;
      case "bulk": router.push(enquiryRoute("bulk")); return;
      case "track":
        if (data?.active_order) {
          router.push({ pathname: "/track/[id]", params: { id: data.active_order.id } });
          return;
        }
        router.push("/customer/orders");
        return;
      case "orders": router.push("/customer/orders");
    }
  }

  return (
    <ThemedScreen>
      <View style={styles.root}>
        <CustomerHomeHeader onRefreshHome={refetch} onDiscoveryLocationChange={setDiscoveryLocation} />
        <CustomerPlantDiscovery onHomeRefresh={refetch} homeLocation={discoveryLocation} homeHeader={
          <>
            <HomeCarousel style={styles.carousel} onAction={openAction} />
            <View testID="home-quick-actions" style={[
              styles.shortcuts,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider },
            ]}>
              <HomeCardRow testID="customer-quick-actions-row" label="Quick actions" minCardWidth={70} gap={4}>
                {homeShortcuts.map(link => (
                  <Pressable key={link.key} testID={`action-${link.key}`} accessibilityRole="button"
                    accessibilityLabel={link.label} accessibilityHint={link.hint}
                    onPress={() => { setShowBulk(false); router.push(link.route); }}
                    style={({ pressed }) => [styles.shortcut, { opacity: pressed ? 0.72 : 1 }]}>
                    <IconTile homeShortcut diagonalFill symbol={link.symbol} size={28} width={40} height={40} />
                    <AppText center style={styles.shortcutLabel}>{link.label}</AppText>
                  </Pressable>
                ))}
              </HomeCardRow>
            </View>
          </>
        } />
        {showBulk ? (
          <View style={[styles.bulkDock, { backgroundColor: colors.canvas }]}>
            <View style={[styles.bulkCard, { backgroundColor: colors.brandSoft, borderColor: colors.border }]}>
              <Pressable testID="home-bulk-quote" accessibilityRole="button" accessibilityLabel="Bulk order? Request a quote"
                onPress={() => { setShowBulk(false); openAction("bulk"); }} style={styles.bulkAction}>
                <IconTile symbol="bulk-quote" width={32} size={20} bulk />
                <View style={styles.bulkCopy}>
                  <AppText variant="label">Bulk Order?</AppText>
                  <AppText variant="caption">Tap for best price</AppText>
                </View>
              </Pressable>
              <Pressable testID="dismiss-home-bulk-quote" accessibilityRole="button" accessibilityLabel="Dismiss bulk order prompt"
                onPress={() => setShowBulk(false)} style={styles.bulkDismiss}>
                <VectorSymbol name="close" size={19} color={colors.onSurfaceSecondary} />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </ThemedScreen>
  );
}

const wrapLongWords = Platform.select<TextStyle>({ web: { overflowWrap: "anywhere" } as TextStyle });

const styles = StyleSheet.create({
  root: { flex: 1 },
  carousel: { maxWidth: 760, borderRadius: 10 },
  shortcuts: { borderWidth: 1, borderRadius: radius.lg, padding: 6 },
  shortcut: { flex: 1, minHeight: control.minTouch, minWidth: 0, alignItems: "center", padding: 2, gap: 4 },
  shortcutLabel: { ...wrapLongWords, fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, width: "100%" },
  bulkDock: { width: "100%", maxWidth: 839, alignSelf: "center", alignItems: "flex-end", paddingHorizontal: 12, paddingVertical: 4 },
  bulkCard: { flexDirection: "row", alignItems: "center", maxWidth: "100%", borderWidth: 1, borderRadius: radius.lg },
  bulkAction: { flexDirection: "row", alignItems: "center", flexShrink: 1, minHeight: control.minTouch, padding: 6, gap: 6 },
  bulkCopy: { flexShrink: 1 },
  bulkDismiss: { width: control.minTouch, minHeight: control.minTouch, alignItems: "center", justifyContent: "center" },
});
