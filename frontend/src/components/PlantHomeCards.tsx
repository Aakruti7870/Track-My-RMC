import { LinearGradient } from "expo-linear-gradient";
import { useRouter, type Href } from "expo-router";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { CardHighlight } from "@/src/components/ui/CardHighlight";
import { IconTile } from "@/src/components/IconTile";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts } from "@/src/theme/tokens";

const plantImage = require("../../assets/images/Plant _Owner_All_staff_top_card.webp");

export function PlantHomeHero({ label, testID, profile, minHeight, maxHeight }: { label: string; testID: string; profile?: Href; minHeight?: number; maxHeight?: number }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={[styles.hero, minHeight === undefined ? null : { minHeight }, maxHeight === undefined ? null : { maxHeight }]}>
      <Image testID={testID} source={plantImage} resizeMode="cover" accessible={false} style={styles.image} />
      <LinearGradient colors={["transparent", "#0E1116", "#0E1116"]}
        locations={[0, 0.76, 1]} style={styles.heroCopy}>
        <AppText color="#F0E5DC" style={styles.heroEyebrow}>Plant Operations</AppText>
        <View style={styles.heroRow}>
          <AppText accessibilityRole="header" color="#FFFFFF" style={styles.heroTitle}>{label}</AppText>
          {profile ? <Pressable testID="plant-home-profile" accessibilityRole="button" accessibilityLabel="Open Plant Profile"
            onPress={() => router.push(profile)} style={[styles.profile, { backgroundColor: colors.success + "38", borderColor: "#BCD1B7" }]}>
            <VectorSymbol name="plant-profile" size={19} color="#ECF6E8" />
            <AppText color="#ECF6E8" style={styles.profileLabel}>Plant Profile</AppText>
          </Pressable> : null}
        </View>
      </LinearGradient>
    </View>
  );
}

export function PlantHomeActions({ action }: { action?: "supplier-enquiry" | "profile" } = {}) {
  const router = useRouter();
  const { colors } = useTheme();
  const actions = [
    { key: "supplier-enquiry", title: "Connect With Best Material Supplier",
      symbol: "supplier-enquiry", highlight: true, onPress: () => router.push("/supplier-enquiry") },
    { key: "profile", title: "Add Plant Profile Details", detail: "Open your plant Profile",
      symbol: "plant-profile", highlight: false,
      onPress: () => router.push({ pathname: "/plant-profile", params: { assigned: "1" } }) },
  ] satisfies { key: string; title: string; detail?: string; symbol: VectorSymbolName; highlight: boolean; onPress: () => void }[];

  return (
    <View style={styles.actions}>
      {actions.filter(item => !action || item.key === action).map(({ key, title, detail, symbol, highlight, onPress }) => (
        <Pressable key={key} testID={`plant-home-${key}`} accessibilityRole="button" accessibilityLabel={title}
          accessibilityHint={detail} onPress={onPress} style={({ pressed }) => [styles.action, {
            backgroundColor: highlight ? colors.brandSoft : colors.surfaceSecondary,
            borderColor: highlight ? colors.brand : colors.divider,
            opacity: pressed ? 0.76 : 1,
          }]}>
          <CardHighlight radius={10} />
          <IconTile symbol={symbol} width={44} height={38} size={24} homeShortcut />
          <View style={styles.actionCopy}>
            <AppText style={styles.actionTitle}>{title}</AppText>
            {detail ? <AppText variant="caption">{detail}</AppText> : null}
          </View>
          <VectorSymbol name="chevron-right" size={20} color={highlight ? colors.accentText : colors.onSurfaceTertiary} />
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
  heroTitle: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, flexShrink: 1 },
  heroRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 },
  profile: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, minHeight: 44, borderRadius: 8, borderWidth: 1 },
  profileLabel: { fontFamily: fonts.semibold, fontSize: 12 },
  actions: { gap: 10, width: "100%", maxWidth: 620, alignSelf: "center" },
  action: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, minHeight: 54.4, flexDirection: "row", alignItems: "center", gap: 10 },
  actionCopy: { flex: 1, minWidth: 0, gap: 2 },
  actionTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
});

export function PlantHomeBanner({ type, destination }: {
  type: "attendance" | "whatsapp"; destination: Href;
}) {
  const router = useRouter();
  const attendance = type === "attendance";
  const title = attendance ? "Geofenced Attendance ERP" : "WhatsApp Dispatch";
  const detail = attendance ? "Track site-based staff check-ins" : "Send trip details when loads dispatch";
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={detail}
    testID={`plant-banner-${type}`} onPress={() => router.push(destination)}
    style={({ pressed }) => [bannerStyles.card, { opacity: pressed ? 0.8 : 1 }]}>
    <Image source={attendance ? require("../../assets/images/plant-attendance-banner.webp")
      : require("../../assets/images/plant-whatsapp-banner.webp")} resizeMode="cover" accessible={false} style={bannerStyles.photo} />
    <LinearGradient pointerEvents="none" colors={["#141C25", "#141C25", "#141C2500"]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} locations={[0, 0.58, 1]} style={StyleSheet.absoluteFill} />
    <View style={bannerStyles.copy}>
      <AppText color="#FFF7EE" style={bannerStyles.title}>{title}</AppText>
      <AppText color={attendance ? "#84EDD5" : "#FFBD82"} style={bannerStyles.detail}>{detail}</AppText>
    </View>
  </Pressable>;
}

const bannerStyles = StyleSheet.create({
  card: { minHeight: 64, padding: 10, justifyContent: "center", borderRadius: 9, overflow: "hidden", backgroundColor: "#141C25" },
  photo: { position: "absolute", right: 0, top: 0, width: "46%", height: "100%" },
  copy: { width: "83%", gap: 3 },
  title: { fontFamily: fonts.bold, fontSize: 14 },
  detail: { fontSize: 10 },
});
