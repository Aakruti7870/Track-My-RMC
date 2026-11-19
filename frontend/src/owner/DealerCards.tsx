import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { IconTile } from "@/src/components/IconTile";
import { AppText } from "@/src/components/ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts } from "@/src/theme/tokens";
import { OwnerGlass } from "./OwnerUI";

export const DEALER_SERVICES = {
  website_design: { label: "Best Website Design", icon: "desktop-outline", type: "PLANT_WEBSITE_DESIGN" },
  buy_domain: { label: "Buy Domain", icon: "globe-outline", type: "PLANT_BUY_DOMAIN" },
  digital_marketing: { label: "Digital Marketing Setup", icon: "megaphone-outline", type: "PLANT_DIGITAL_MARKETING" },
  plant_accessories: { label: "Plant Accessories Supplier", icon: "construct-outline", type: "PLANT_ACCESSORIES" },
} as const;
export type DealerService = keyof typeof DEALER_SERVICES;

const GAP = 8;
const items = [
  { key: "materials", label: "All Types of Material Suppliers", icon: "cube-outline" },
  ...Object.entries(DEALER_SERVICES).map(([key, service]) => ({ key, ...service })),
] as const;

export function DealerCards({ plantId, contentWidth }: { plantId?: string; contentWidth: number }) {
  const router = useRouter();
  const { colors, reduceMotion } = useTheme();
  const { fontScale } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const [offset, setOffset] = useState(0);
  const minCardWidth = Math.ceil(145 * fontScale);
  const gapWidth = (items.length - 1) * GAP;
  const cardWidth = contentWidth >= items.length * minCardWidth + gapWidth
    ? Math.floor((contentWidth - gapWidth) / items.length)
    : Math.min(contentWidth, Math.max(minCardWidth, Math.floor(contentWidth * 0.46)));
  const maxOffset = Math.max(0, items.length * cardWidth + gapWidth - contentWidth);

  function move(direction: number) {
    const x = Math.max(0, Math.min(maxOffset, offset + direction * (cardWidth + GAP)));
    scroll.current?.scrollTo({ x, animated: !reduceMotion });
  }

  return <View testID="owner-dealer-section" style={styles.section}>
    <View style={styles.heading}>
      <AppText accessibilityRole="header" variant="heading" style={styles.title}>Connect with Best Dealer &amp; Supplier</AppText>
      {maxOffset > 0 ? <View style={styles.buttons}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous dealer cards" disabled={offset <= 1}
          onPress={() => move(-1)} style={[styles.button, { borderColor: colors.divider, opacity: offset <= 1 ? 0.45 : 1 }]}>
          <Ionicons name="chevron-back" size={17} color={colors.onSurface} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next dealer cards" disabled={offset >= maxOffset - 1}
          onPress={() => move(1)} style={[styles.button, { borderColor: colors.divider, opacity: offset >= maxOffset - 1 ? 0.45 : 1 }]}>
          <Ionicons name="chevron-forward" size={17} color={colors.onSurface} />
        </Pressable>
      </View> : null}
    </View>
    <ScrollView ref={scroll} horizontal testID="owner-dealer-carousel" showsHorizontalScrollIndicator={false}
      onScroll={event => setOffset(event.nativeEvent.contentOffset.x)} scrollEventThrottle={32}
      contentContainerStyle={styles.rail}>
      {items.map(item => {
        const destination: Href = item.key === "materials"
          ? { pathname: "/supplier-enquiry", params: { plantId } }
          : { pathname: "/dealer-enquiry", params: { service: item.key, plantId } };
        return <Pressable key={item.key} testID={`owner-dealer-${item.key}`}
          accessibilityRole="button" accessibilityLabel={item.label}
          onPress={() => router.push(destination)}
          style={({ pressed }) => ({ width: cardWidth, opacity: pressed ? 0.75 : 1 })}>
          <OwnerGlass highlighted={false} style={styles.card}>
            <View style={styles.cardTop}>
              <IconTile icon={item.icon} size={23} width={42} height={42} homeShortcut />
              <Ionicons name="chevron-forward" size={16} color={colors.accentText} />
            </View>
            <AppText style={styles.label}>{item.label}</AppText>
          </OwnerGlass>
        </Pressable>;
      })}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 6 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 },
  title: { flexGrow: 1, flexShrink: 1, flexBasis: 180, fontSize: 17, lineHeight: 23 },
  buttons: { flexDirection: "row", gap: 5 },
  button: { width: 44, height: 44, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rail: { gap: GAP, paddingBottom: 2 },
  card: { flex: 1, minHeight: 105, padding: 10, gap: 7, justifyContent: "space-between" },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
});
