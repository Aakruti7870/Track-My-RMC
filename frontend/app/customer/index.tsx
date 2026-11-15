import React from "react";
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ActiveTransitMixerCard } from "@/src/components/ActiveTransitMixerCard";
import { KycBanner } from "@/src/components/KycBanner";
import { ErrorView } from "@/src/components/StateViews";
import { HomeCarousel } from "@/src/components/HomeCarousel";
import { CustomerHomeHeader } from "@/src/components/customer/CustomerHomeHeader";
import { CustomerNextAction } from "@/src/components/customer/CustomerNextAction";
import type { OrderData } from "@/src/components/OrderCard";
import type { PlantData } from "@/src/components/PlantCard";
import { customerHomeSizes, fonts, radius } from "@/src/theme/tokens";
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
  const homeSize = customerHomeSizes(viewportWidth, Platform.OS);
  const headingSize = { fontSize: homeSize.headerSize, lineHeight: homeSize.headerLine };
  const [quickGridWidth, setQuickGridWidth] = React.useState(0);
  const fourColumns = quickGridWidth >= 270;
  const { user } = useAuth();
  const router = useRouter();
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/customer/home");

  const onAction = (key: ActionKey) => {
    if (key === "plants") return router.push("/customer/plants");
    if (key === "orders") return router.push("/customer/orders");
    if (key === "track") {
      // No active order: open the order directory instead of a dead-end toast.
      if (data?.active_order) return router.push(`/track/${data.active_order.id}` as any);
      return router.push("/customer/orders");
    }
    // New Order supports safe drafts and provisional requests before DigiLocker.
    // The real order confirmation remains gated by the server-side KYC flow.
    return router.push("/new-order");
  };
  const openService = (service: ServiceKey) => {
    router.push({ pathname: "/customer/service-enquiry", params: { service } });
  };

  // The mobile shortcuts preserve their 52dp symbols and KYC guards.
  const quickActions = (
    <View testID="home-quick-actions" style={[styles.groupCard, styles.tightGroup, styles.quickActionsGroup]}>
      <AppText style={[styles.sectionTitle, headingSize, { color: colors.onSurface }]}>Quick Actions</AppText>
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
            style={({ pressed }) => [styles.tile, styles.quickTile, { minHeight: homeSize.quickTile, width: fourColumns ? "24.25%" : "49%", opacity: pressed ? 0.7 : 1 }]}
          >
            <VectorSymbol name={action.symbol} size={homeSize.quickSymbol}
              color={action.key === "new" ? (colors.isDark ? colors.onBrandSoft : "#9C4100") : undefined} />
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
            style={({ pressed }) => [styles.tile, styles.directoryTile, { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, minHeight: homeSize.toolTile, width: fourColumns ? "24.25%" : "49%", opacity: pressed ? 0.7 : 1 }]}
          >
            {module.symbol ? <VectorSymbol name={module.symbol} size={homeSize.toolSymbol} /> : <Ionicons name={module.icon} size={homeSize.toolSymbol} color={colors.onSurfaceTertiary} />}
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
        style={({ pressed }) => [styles.promoCard, styles.promoPrimaryCard, { width: homeSize.pumpWidth, height: homeSize.pumpHeight, borderRadius: homeSize.pumpRadius, paddingHorizontal: homeSize.pumpPadding, gap: homeSize.pumpGap, backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, opacity: pressed ? 0.76 : 1 }]}>
        <VectorSymbol name="pump-rental" size={homeSize.pumpSymbol} />
        <View style={styles.promoCopy}>
          <AppText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
            style={[styles.promoFirstLine, { fontSize: homeSize.pumpFirstSize, lineHeight: homeSize.pumpFirstLine, color: colors.onSurface }]}>Concrete pump rental</AppText>
          <AppText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
            style={[styles.promoSecondLine, { fontSize: homeSize.pumpSecondSize, lineHeight: homeSize.pumpSecondLine, color: colors.onSurface }]}>Request a quote</AppText>
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
            style={({ pressed }) => [styles.tile, styles.directoryTile, { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, minHeight: homeSize.serviceTile, width: "32.5%", opacity: pressed ? 0.7 : 1 }]}
          >
            <VectorSymbol name={service.symbol} size={homeSize.serviceSymbol} />
            <AppText numberOfLines={2} style={[styles.serviceLabel, { fontSize: homeSize.serviceLabel, lineHeight: homeSize.serviceLabelLine, color: colors.onSurface }]}>{service.label}</AppText>
          </Pressable>
        ))}
      </View>
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
              <CustomerNextAction
                activeOrder={data.active_order}
                hasOrderHistory={data.recent_orders.length > 0}
                kycVerified={(data.kyc_status || user?.kyc_status || "").toUpperCase() === "VERIFIED"}
                onCreateOrder={() => onAction("new")}
                onViewOrder={(id) => router.push({ pathname: "/order/[id]", params: { id } })}
                onViewOrders={() => router.push("/customer/orders")}
                onVerifyIdentity={() => router.push("/kyc")}
              />
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 88, gap: 10, maxWidth: 1100, alignSelf: "center", width: "100%" },
  // Ten-dp separation between Home sections, while the carousel extends to
  // the viewport edges and the content keeps 16-dp side gutters.
  groupCard: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: 0, paddingVertical: 0, gap: 0 },
  homeAboveFold: { width: "100%", gap: 10 },
  tightGroup: { paddingVertical: 0, gap: 0 },
  // Keep a 10dp gap from the carousel and below each section heading.
  quickActionsGroup: { paddingTop: 0, paddingBottom: 0 },
  quickGrid: { marginTop: 10 },
  toolGrid: { marginTop: 10 },
  serviceGrid: { marginTop: 10 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, paddingHorizontal: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", width: "100%", justifyContent: "space-between", rowGap: 10 },
  tile: { alignItems: "center", justifyContent: "center", paddingHorizontal: 1, paddingVertical: 2, gap: 4 },
  quickTile: { paddingVertical: 6, gap: 6 },
  directoryTile: { paddingHorizontal: 4, paddingVertical: 8, gap: 6, borderWidth: 1, borderRadius: radius.md },
  quickLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, textAlign: "center", minHeight: 18 },
  tileLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 13, textAlign: "center" },
  // Center the sole 240x50dp pump CTA; no empty secondary promo slot.
  promoRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: 620, alignSelf: "center" },
  promoCard: { minWidth: 0, height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 2 },
  promoPrimaryCard: { width: 240 },
  promoCopy: { flex: 1, minWidth: 0, justifyContent: "center", gap: 1 },
  promoFirstLine: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 16 },
  promoSecondLine: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 18 },
  serviceLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 15, textAlign: "center" },
});
