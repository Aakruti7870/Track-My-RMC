import React from "react";
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ActiveTransitMixerCard } from "@/src/components/ActiveTransitMixerCard";
import { KycBanner } from "@/src/components/KycBanner";
import { ErrorView } from "@/src/components/StateViews";
import { HomeCarousel } from "@/src/components/HomeCarousel";
import { CustomerHomeHeader } from "@/src/components/customer/CustomerHomeHeader";
import type { OrderData } from "@/src/components/OrderCard";
import type { PlantData } from "@/src/components/PlantCard";
import { customerHomeSizes, fonts, radius, spacing } from "@/src/theme/tokens";
import { modulesForRole } from "@/src/navigation/moduleCatalog";

type HomeData = {
  name: string;
  kyc_status: string;
  active_order: OrderData | null;
  recent_orders: OrderData[];
  nearby_plants: PlantData[];
  unread_notifications: number;
};
type ActionKey = "new" | "track" | "plants" | "orders";
type ServiceKey = "cement" | "labour" | "material";

const ACTIONS: readonly { key: ActionKey; label: string; symbol: VectorSymbolName }[] = [
  { key: "new", label: "New Order", symbol: "new-order" },
  { key: "track", label: "Track Order", symbol: "live-order-tracking" },
  { key: "plants", label: "Plants", symbol: "nearby-rmc-plants" },
  { key: "orders", label: "My Orders", symbol: "my-orders" },
];

// Home-only selection. All other modules remain available from the More directory.
const HOME_MODULE_KEYS = [
  "projects", "pour-planner", "receiving-guide", "cube-tests",
  "saved-sites", "customer-support", "compare-plants", "free-tools",
] as const;
const DIRECTORY = modulesForRole("customer");
const CUSTOMER_MODULES = HOME_MODULE_KEYS.flatMap(key => DIRECTORY.filter(module => module.key === key));

const SERVICES: readonly { key: ServiceKey; label: string; symbol: VectorSymbolName }[] = [
  { key: "cement", label: "Cement", symbol: "cement" },
  { key: "labour", label: "Labour Contractor", symbol: "labour-contractor" },
  { key: "material", label: "Building Material", symbol: "building-material" },
];

export default function CustomerHome() {
  const { colors } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // One viewport policy sizes symbols, cards, typography and spacing together.
  // Native devices always retain the approved PR #152 mobile dimensions.
  const homeSize = customerHomeSizes(viewportWidth, Platform.OS);
  const headingSize = { fontSize: homeSize.headerSize, lineHeight: homeSize.headerLine };
  const [quickGridWidth, setQuickGridWidth] = React.useState(0);
  // At small viewports, two columns preserve the requested 52-unit SVGs without clipping.
  const fourQuickColumns = quickGridWidth >= 270;
  const fourToolColumns = quickGridWidth >= 270;
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/customer/home");

  const onAction = (key: ActionKey) => {
    if (key === "plants") return router.push("/customer/plants");
    if (key === "orders") return router.push("/customer/orders");
    if (key === "track") {
      // No active order: open the order directory instead of a dead-end toast.
      if (data?.active_order) return router.push(`/track/${data.active_order.id}` as any);
      return router.push("/customer/orders");
    }
    if ((data?.kyc_status ?? user?.kyc_status) !== "VERIFIED") {
      toast("Complete KYC to place an order", "info");
      return router.push("/kyc");
    }
    return router.push("/new-order");
  };
  const openService = (service: ServiceKey) => {
    router.push({ pathname: "/customer/service-enquiry", params: { service } });
  };

  // The mobile shortcuts preserve their 52dp symbols and KYC guards.
  // Tablet/desktop web frames and captions grow with the symbol artwork.
  const quickActions = (
    <View testID="home-quick-actions" style={[styles.groupCard, styles.tightGroup, styles.quickActionsGroup]}>
      <View style={styles.sectionHeaderRow}>
        <AppText style={[styles.sectionTitle, headingSize, { color: colors.onSurface }]}>Quick Actions</AppText>
        <View style={[styles.slogan, { width: homeSize.sloganWidth, minHeight: homeSize.sloganHeight, borderRadius: homeSize.sloganHeight / 2, backgroundColor: colors.verified + "14" }]} accessibilityLabel="Built Better">
          <Ionicons name="shield-checkmark" size={homeSize.sloganIcon} color={colors.verified} />
          <AppText style={[styles.sloganText, headingSize, { color: colors.verified }]}>Built Better</AppText>
        </View>
      </View>
      <View style={[styles.grid, styles.quickGrid, { marginTop: homeSize.sectionGap, rowGap: homeSize.gridGap }]} onLayout={event => {
        const width = event.nativeEvent.layout.width;
        setQuickGridWidth(previous => Math.abs(previous - width) > 1 ? width : previous);
      }}>
        {ACTIONS.map(action => (
          <Pressable
            key={action.key}
            testID={`action-${action.key}`}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => onAction(action.key)}
            style={({ pressed }) => [styles.tile, styles.quickTile, { minHeight: homeSize.quickTile, width: fourQuickColumns ? "24.25%" : "49%", opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.quickCircle, { width: homeSize.quickCircle, height: homeSize.quickCircle, borderRadius: homeSize.quickCircle / 2, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <VectorSymbol name={action.symbol} size={homeSize.quickSymbol} />
            </View>
            <AppText numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}
              style={[styles.quickLabel, { fontSize: homeSize.quickLabel, lineHeight: homeSize.quickLabelLine, minHeight: homeSize.quickLabelMin, color: colors.onSurface }]}>{action.label}</AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );

  // Keep the original eight module keys in the registered catalog and simply
  // present them as two clearly named four-item sections.
  const renderModuleGroup = (keys: readonly string[], title: string, testID: string) => (
    <View testID={testID} style={[styles.groupCard, styles.tightGroup]}>
      <AppText style={[styles.sectionTitle, headingSize, { color: colors.onSurface }]}>{title}</AppText>
      <View style={[styles.grid, styles.toolGrid, { marginTop: homeSize.sectionGap, rowGap: homeSize.gridGap }]}>
        {keys.flatMap(key => CUSTOMER_MODULES.filter(module => module.key === key)).map(module => (
          <Pressable
            key={module.key}
            testID={`customer-module-${module.key}`}
            accessibilityRole="button"
            accessibilityLabel={module.label}
            onPress={() => router.push(module.route)}
            style={({ pressed }) => [styles.tile, styles.toolTile, { minHeight: homeSize.toolTile, width: fourToolColumns ? "24.25%" : "49%", opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.toolPlate, { height: homeSize.toolPlate, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              {module.symbol ? <VectorSymbol name={module.symbol} size={homeSize.toolSymbol} /> : <Ionicons name={module.icon} size={homeSize.toolSymbol} color={colors.brand} />}
            </View>
            <AppText numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.85}
              style={[styles.tileLabel, { fontSize: homeSize.toolLabel, lineHeight: homeSize.toolLabelLine, color: colors.onSurface }]}>
              {module.key === "projects" ? "Project Hub" : module.key === "free-tools" ? "RMC Calculator" : module.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
  const planningTools = renderModuleGroup(
    ["pour-planner", "compare-plants", "projects", "saved-sites"],
    "Active Projects & Planning", "customer-module-grid",
  );
  const adviceTools = renderModuleGroup(
    ["free-tools", "receiving-guide", "cube-tests", "customer-support"],
    "Free Tools & Expert Advice", "home-advice-grid",
  );

  // Pump rental is a dedicated service enquiry, not a confirmed booking.
  const pumpOffer = (
    <View testID="home-pump-rental-promo" style={styles.promoRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Request a concrete pump rental enquiry"
        accessibilityHint="Opens the concrete pump rental enquiry form"
        onPress={() => router.push({ pathname: "/customer/service-enquiry", params: { service: "pump" } })}
        style={({ pressed }) => [styles.promoCard, styles.promoPrimaryCard, { width: homeSize.pumpWidth, height: homeSize.pumpHeight, borderRadius: homeSize.pumpRadius, paddingHorizontal: homeSize.pumpPadding, gap: homeSize.pumpGap, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: pressed ? 0.76 : 1 }]}>
        <Svg width={homeSize.pumpIconWidth} height={homeSize.pumpIconHeight} viewBox="0 0 64 64" accessible={false}>
          <Rect x="4" y="34" width="40" height="14" rx="3" fill={colors.brand} />
          <Rect x="28" y="27" width="15" height="9" rx="2" fill={colors.surface} stroke={colors.brand} strokeWidth="2" />
          <Path d="M10 34 20 16 31 26 42 11 54 21 54 34" stroke={colors.brand} strokeWidth="5"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Circle cx="15" cy="49" r="6" fill={colors.onSurface} />
          <Circle cx="36" cy="49" r="6" fill={colors.onSurface} />
          <Circle cx="15" cy="49" r="2.5" fill={colors.surface} />
          <Circle cx="36" cy="49" r="2.5" fill={colors.surface} />
        </Svg>
        <View style={styles.promoCopy}>
          <AppText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
            style={[styles.promoFirstLine, { fontSize: homeSize.pumpFirstSize, lineHeight: homeSize.pumpFirstLine, color: colors.onSurface }]}>Streamline Your Pour</AppText>
          <AppText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
            style={[styles.promoSecondLine, { fontSize: homeSize.pumpSecondSize, lineHeight: homeSize.pumpSecondLine, color: colors.onSurface }]}>Request a Pump Quote</AppText>
        </View>
      </Pressable>
    </View>
  );

  const otherServices = (
    <View testID="home-other-services" style={styles.groupCard}>
      <AppText style={[styles.sectionTitle, headingSize, { color: colors.onSurface }]}>Supply & Workforce</AppText>
      <View style={[styles.grid, styles.serviceGrid, { marginTop: homeSize.sectionGap, rowGap: homeSize.gridGap }]}>
        {SERVICES.map(service => (
          <Pressable
            key={service.key}
            testID={`service-${service.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${service.label} enquiry`}
            onPress={() => openService(service.key)}
            style={({ pressed }) => [styles.tile, styles.serviceTile, { minHeight: homeSize.serviceTile, width: "32.5%", opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.servicePlate, { height: homeSize.servicePlate, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <VectorSymbol name={service.symbol} size={homeSize.serviceSymbol} />
            </View>
            <AppText numberOfLines={2} style={[styles.serviceLabel, { fontSize: homeSize.serviceLabel, lineHeight: homeSize.serviceLabelLine, color: colors.onSurface }]}>{service.label}</AppText>
          </Pressable>
        ))}
      </View>
      <AppText variant="caption" style={{ textAlign: "center", fontSize: homeSize.serviceLabel, lineHeight: Math.max(18, homeSize.serviceLabelLine), marginTop: Math.min(6, homeSize.sectionGap) }}>Send an enquiry; our team will contact you.</AppText>
    </View>
  );

  return (
    <ThemedScreen>
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <CustomerHomeHeader onRefreshHome={refetch} />

      <ScrollView
        testID="customer-home-scroll"
        contentContainerStyle={[styles.scrollContent, { gap: homeSize.sectionGap, paddingBottom: 88 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}
      >
        {error && !data ? (
          <>
            <ErrorView message={error} onRetry={reload} />
            <View style={[styles.homeAboveFold, { gap: homeSize.sectionGap }]}>
              {quickActions}
              <View style={styles.groupCard}><KycBanner status={user?.kyc_status || "NOT_STARTED"} /></View>
              {planningTools}
              {pumpOffer}
              {adviceTools}
            </View>
            {otherServices}
          </>
        ) : loading && !data ? (
          <>
            <Skeleton height={330} style={{ borderRadius: radius.xl }} />
            <Skeleton height={168} style={{ borderRadius: radius.lg }} />
            <Skeleton height={90} style={{ borderRadius: radius.lg }} />
            <Skeleton height={260} style={{ borderRadius: radius.lg }} />
          </>
        ) : data ? (
          <>
            {/* Existing carousel and its five images remain unchanged. */}
            <View style={[styles.homeAboveFold, { gap: homeSize.sectionGap }]}>
              <HomeCarousel style={{ width: Math.min(viewportWidth, 720), borderRadius: 0, borderWidth: 0 }} />
              {quickActions}
              <View style={styles.groupCard}><KycBanner status={data.kyc_status} /></View>
              {planningTools}
              {pumpOffer}
              {adviceTools}
            </View>
            {otherServices}
            {/* Preserve the existing active-order, stale-GPS and demo selection workflow. */}
            <ActiveTransitMixerCard
              order={data.active_order || data.recent_orders[0] || null}
              onNewOrder={() => onAction("new")}
              onRefreshHome={refetch}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  wordmark: { gap: 0 },
  wordmarkSmall: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 1.1, lineHeight: 15 },
  wordmarkBig: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 31, letterSpacing: -0.8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 9 },
  verifiedPill: { minHeight: 42, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  verifiedText: { fontFamily: fonts.bold, fontSize: 11 },
  kycPending: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  dot: { position: "absolute", top: 7, right: 7, width: 8, height: 8, borderRadius: 4 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 88, gap: 10, maxWidth: 1100, alignSelf: "center", width: "100%" },
  // Ten-dp separation between Home sections, while the carousel extends to
  // the viewport edges and the content keeps 16-dp side gutters.
  groupCard: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: 0, paddingVertical: 0, gap: 0 },
  homeAboveFold: { width: "100%", gap: 10 },
  tightGroup: { paddingVertical: 0, gap: 0 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 20 },
  // Keep a 10dp gap from the carousel and below each section heading.
  quickActionsGroup: { paddingTop: 0, paddingBottom: 0 },
  quickGrid: { marginTop: 10 },
  toolGrid: { marginTop: 10 },
  serviceGrid: { marginTop: 10 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, paddingHorizontal: 2 },
  slogan: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, width: 132, minHeight: 28, borderRadius: 14, paddingHorizontal: 5 },
  sloganText: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", width: "100%", justifyContent: "space-between", rowGap: 10 },
  tile: { alignItems: "center", justifyContent: "center", paddingHorizontal: 1, paddingVertical: 2, gap: 4 },
  quickTile: { minHeight: 82, paddingVertical: 0, gap: 6, borderWidth: 0, justifyContent: "flex-start" },
  quickCircle: { width: 56, height: 56, borderRadius: 28, overflow: "hidden", borderWidth: 1, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, textAlign: "center", minHeight: 18 },
  toolTile: { minHeight: 101, paddingVertical: 0, gap: 4, justifyContent: "flex-start" },
  toolPlate: { width: "100%", height: 56, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  tileLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 13, textAlign: "center" },
  // Center the sole 240x50dp pump CTA; no empty secondary promo slot.
  promoRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: 620, alignSelf: "center" },
  promoCard: { minWidth: 0, height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 2 },
  promoPrimaryCard: { width: 240 },
  promoCopy: { flex: 1, minWidth: 0, justifyContent: "center", gap: 1 },
  promoFirstLine: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 16 },
  promoSecondLine: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 18 },
  serviceTile: { minHeight: 103, paddingVertical: 0, gap: 4, justifyContent: "flex-start" },
  servicePlate: { width: "100%", height: 62, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  serviceLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 15, textAlign: "center" },
});
