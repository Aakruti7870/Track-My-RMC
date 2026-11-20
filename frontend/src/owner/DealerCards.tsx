import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { HomeCardRow } from "@/src/components/HomeCardRow";
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

const items = [
  { key: "materials", label: "All Types of Material Suppliers", icon: "cube-outline" },
  ...Object.entries(DEALER_SERVICES).map(([key, service]) => ({ key, ...service })),
] as const;

export function DealerCards({ plantId }: { plantId?: string }) {
  const router = useRouter();
  const { colors } = useTheme();

  return <View testID="owner-dealer-section" style={styles.section}>
    <AppText accessibilityRole="header" variant="heading" style={styles.title}>Connect with Best Dealer &amp; Supplier</AppText>
    <HomeCardRow testID="owner-dealer-carousel" label="Dealer and supplier services" minCardWidth={145}>
      {items.map(item => {
        const destination: Href = item.key === "materials"
          ? { pathname: "/supplier-enquiry", params: { plantId } }
          : { pathname: "/dealer-enquiry", params: { service: item.key, plantId } };
        return <Pressable key={item.key} testID={`owner-dealer-${item.key}`}
          accessibilityRole="button" accessibilityLabel={item.label}
          onPress={() => router.push(destination)}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.75 : 1 })}>
          <OwnerGlass highlighted={false} style={styles.card}>
            <View style={styles.cardTop}>
              <IconTile icon={item.icon} size={23} width={42} height={42} homeShortcut />
              <Ionicons name="chevron-forward" size={16} color={colors.accentText} />
            </View>
            <AppText style={styles.label}>{item.label}</AppText>
          </OwnerGlass>
        </Pressable>;
      })}
    </HomeCardRow>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 6 },
  title: { fontSize: 17, lineHeight: 23 },
  card: { flex: 1, minHeight: 105, padding: 10, gap: 7, justifyContent: "space-between" },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
});
