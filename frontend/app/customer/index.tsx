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
  "saved-sites", "compare-plants", "free-tools",
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
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const homeSize = customerHomeSizes(viewportWidth, Platform.OS);
  const headingSize = { fontSize: homeSize.headerSize, lineHeight: homeSize.headerLine };
  const [quickGridWidth, setQuickGridWidth] = React.useState(0);
  const readableGridWidth = quickGridWidth / fontScale;
  const quickTileWidth = readableGridWidth >= 270 ? "24.25%" : "49%";
  const toolTileWidth = readableGridWidth >= 350 ? "24.25%" : "49%";
  const serviceTileWidth = readableGridWidth >= 280 ? "32.5%" : "100%";
  const { user } = useAuth();
  const router = useRouter();
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/customer/home");

  const loadingHome = loading && !data && !error;

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
            style={({ pressed }) => [styles.tile, styles.quickTile, { minHeight: homeSize.quickTile, width: quickTileWidth, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.quickIconPlate, { backgroundColor: colors.surfaceTertiary }]}>
              <VectorSymbol name={action.symbol} size={homeSize.quickSymbol}
                color={action.key === "new" ? colors.accentText : colors.onSurfaceTertiary} />
            </View>
            <AppText maxFontSizeMultiplier={0}
              style={[styles.quickLabel, { fontSize: homeSize.quickLabel, lineHeight: homeSize.quickLabelLine, minHeight: homeSize.quickLabelMin, color: colors.onSurface }]}>{action.label}</AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );

  // Show planning and advice in distinct groups. Account support lives in Help and More.
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
            style={({ pressed }) => [styles.tile, styles.directoryTile, { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, minHeight: homeSize.toolTile, width: keys.length === 3 && readableGridWidth >= 350 ? "32.5%" : toolTileWidth, opacity: pressed ? 0.7 : 1 }]}
          >
            {module.symbol ? <VectorSymbol name={module.symbol} size={homeSize.toolSymbol} /> : <Ionicons name={module.icon} size={homeSize.toolSymbol} color={colors.onSurfaceTertiary} />}
            <AppText maxFontSizeMultiplier={0}
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
    ["free-tools", "receiving-guide", "cube-tests"],
    "Free Tools & Expert Advice", "home-advice-grid",
  );

  const planningActionItems: readonly {
    key: string; title: string; description: string; symbol: VectorSymbolName; onPress: () => void;
  }[] = [
    {
      key: "pump-rental", title: "Concrete pump rental", description: "Request a quote", symbol: "pump-rental",
      onPress: () => router.push({ pathname: "/customer/service-enquiry", params: { service: "pump" } }),
    },
    {
      key: "order-request", title: "Start an Order Request", symbol: "new-order",
      description: "Build and save a request without completing KYC first",
      onPress: () => onAction("new"),
    },
  ];
  const planningActions = (
    <View testID="home-planning-actions" style={[styles.groupCard, styles.planningActions, { gap: homeSize.gridGap }]}>
      {planningActionItems.map(action => (
        <Pressable key={action.key} testID={`home-${action.key}`} accessibilityRole="button"
          accessibilityLabel={action.title} accessibilityHint={action.description} onPress={action.onPress}
          style={({ pressed }) => [styles.planningAction, {
            minHeight: homeSize.planningActionHeight,
            backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, opacity: pressed ? 0.76 : 1,
          }]}>
          <VectorSymbol name={action.symbol} size={homeSize.toolSymbol} color={colors.accentText} />
          <AppText style={[styles.planningActionTitle, { fontSize: homeSize.quickLabel, lineHeight: homeSize.quickLabelLine }]}>
            {action.title}
          </AppText>
          <AppText style={{ fontSize: homeSize.toolLabel, lineHeight: homeSize.toolLabelLine, color: colors.onSurfaceTertiary }}>
            {action.description}
          </AppText>
        </Pressable>
      ))}
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
            style={({ pressed }) => [styles.tile, styles.directoryTile, { backgroundColor: colors.surfaceSecondary, borderColor: colors.divider, minHeight: homeSize.serviceTile, width: serviceTileWidth, opacity: pressed ? 0.7 : 1 }]}
          >
            <VectorSymbol name={service.symbol} size={homeSize.serviceSymbol} />
            <AppText maxFontSizeMultiplier={0} style={[styles.serviceLabel, { fontSize: homeSize.serviceLabel, lineHeight: homeSize.serviceLabelLine, color: colors.onSurface }]}>{service.label}</AppText>
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
          contentContainerStyle={[styles.scrollContent, { gap: homeSize.sectionGap, paddingBottom: homeSize.sectionGap + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.accentText} />}
        >
          <HomeCarousel style={styles.carousel} />
          {loadingHome ? (
            <View style={[styles.groupCard, { gap: homeSize.sectionGap }]}>
              <Skeleton height={120} style={{ borderRadius: radius.lg }} />
              <Skeleton height={56} style={{ borderRadius: radius.lg }} />
              <Skeleton height={176} style={{ borderRadius: radius.lg }} />
            </View>
          ) : (
            <>
              {quickActions}
              {error && !data ? <View style={styles.groupCard}><ErrorView message={error} onRetry={reload} /></View> : null}
              <View style={styles.groupCard}><KycBanner status={data?.kyc_status ?? user?.kyc_status ?? "NOT_STARTED"} /></View>
              {planningTools}
              {planningActions}
              {adviceTools}
              {otherServices}
              {data ? (
                <ActiveTransitMixerCard
                  order={data.active_order || data.recent_orders[0] || null}
                  onNewOrder={() => onAction("new")}
                  onRefreshHome={refetch}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 10, alignSelf: "center", width: "100%" },
  carousel: { maxWidth: 620, borderRadius: radius.md },
  groupCard: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: 0, paddingVertical: 0, gap: 0 },
  tightGroup: { paddingVertical: 0, gap: 0 },
  // Keep a 10dp gap from the carousel and below each section heading.
  quickActionsGroup: { paddingTop: 0, paddingBottom: 0 },
  quickGrid: { marginTop: 10 },
  toolGrid: { marginTop: 10 },
  serviceGrid: { marginTop: 10 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, paddingHorizontal: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", width: "100%", justifyContent: "space-between", rowGap: 10 },
  tile: { minWidth: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 1, paddingVertical: 2, gap: 4 },
  quickTile: { paddingVertical: 6, gap: 6 },
  quickIconPlate: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  directoryTile: { paddingHorizontal: 4, paddingVertical: 8, gap: 6, borderWidth: 1, borderRadius: radius.md },
  quickLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, textAlign: "center", maxWidth: "100%", minHeight: 18 },
  tileLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 13, textAlign: "center", maxWidth: "100%" },
  planningActions: { flexDirection: "row", alignItems: "stretch" },
  planningAction: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: radius.lg, padding: 12, gap: 4 },
  planningActionTitle: { fontFamily: fonts.semibold },
  serviceLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 15, textAlign: "center", maxWidth: "100%" },
});
