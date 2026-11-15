import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { IconTile } from "@/src/components/IconTile";
import { AppText } from "@/src/components/ui/AppText";
import type { VectorSymbolName } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts } from "@/src/theme/tokens";

const plantImage = require("../../assets/images/Plant _Owner_All_staff_top_card.webp");

export function PlantHomeHero({ label, testID }: { label: string; testID: string }) {
  return (
    <View style={styles.hero}>
      <Image testID={testID} source={plantImage} resizeMode="cover" accessible={false} style={styles.image} />
      <LinearGradient pointerEvents="none" colors={["transparent", "#0E1116", "#0E1116"]}
        locations={[0, 0.76, 1]} style={styles.heroCopy}>
        <AppText color="#F0E5DC" style={styles.heroEyebrow}>Plant Operations</AppText>
        <AppText accessibilityRole="header" color="#FFFFFF" style={styles.heroTitle}>{label}</AppText>
      </LinearGradient>
    </View>
  );
}

export function PlantHomeActions() {
  const router = useRouter();
  const { colors } = useTheme();
  const actions = [
    { key: "supplier-enquiry", title: "Connect With Best Material Supplier", detail: "Request quotes for up to 3 materials",
      symbol: "suppliers", highlight: true, onPress: () => router.push("/supplier-enquiry") },
    { key: "profile", title: "Add Plant Profile Details", detail: "Open your assigned plant profile",
      symbol: "plant-profile", highlight: false,
      onPress: () => router.push({ pathname: "/plant-profile", params: { assigned: "1" } }) },
  ] satisfies { key: string; title: string; detail: string; symbol: VectorSymbolName; highlight: boolean; onPress: () => void }[];

  return (
    <View style={styles.actions}>
      {actions.map(({ key, title, detail, symbol, highlight, onPress }) => (
        <Pressable key={key} testID={`plant-home-${key}`} accessibilityRole="button" accessibilityLabel={title}
          accessibilityHint={detail} onPress={onPress} style={({ pressed }) => [styles.action, {
            backgroundColor: highlight ? colors.brandSoft : colors.surfaceSecondary,
            borderColor: highlight ? colors.brand : colors.divider,
            opacity: pressed ? 0.76 : 1,
          }]}>
          <IconTile symbol={symbol} />
          <View style={styles.actionCopy}>
            <AppText style={styles.actionTitle}>{title}</AppText>
            <AppText variant="caption">{detail}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={highlight ? colors.accentText : colors.onSurfaceTertiary}
            accessible={false} aria-hidden />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: "100%", aspectRatio: 2107 / 746, minHeight: 152, justifyContent: "flex-end", overflow: "hidden", borderRadius: 10 },
  image: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  heroCopy: { paddingHorizontal: 15, paddingBottom: 12, paddingTop: 25, gap: 2 },
  heroEyebrow: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  heroTitle: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  actions: { gap: 10, width: "100%", maxWidth: 620, alignSelf: "center" },
  action: { borderWidth: 1, borderRadius: 10, padding: 9, minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10 },
  actionCopy: { flex: 1, minWidth: 0, gap: 2 },
  actionTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
});
