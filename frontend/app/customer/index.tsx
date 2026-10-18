import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ActiveTransitMixerCard } from "@/src/components/ActiveTransitMixerCard";
import { KycBanner } from "@/src/components/KycBanner";
import { ErrorView } from "@/src/components/StateViews";
import { HomeCarousel } from "@/src/components/HomeCarousel";
import { CustomerHomeHeader } from "@/src/components/customer/CustomerHomeHeader";
import type { OrderData } from "@/src/components/OrderCard";
import type { PlantData } from "@/src/components/PlantCard";
import { fonts, radius, spacing } from "@/src/theme/tokens";
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
  { key: "plants", label: "Available Plants", symbol: "nearby-rmc-plants" },
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
  const [quickGridWidth, setQuickGridWidth] = React.useState(0);
  // At small viewports, two columns preserve the requested 75-unit SVGs without clipping.
  const fourQuickColumns = quickGridWidth >= 355;
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

  const quickActions = (
    <Card testID="home-quick-actions" style={styles.groupCard}>
      <AppText style={[styles.sectionTitle, { color: colors.onSurface }]}>Quick Actions</AppText>
      <View style={styles.grid} onLayout={event => {
        const width = event.nativeEvent.layout.width;
        setQuickGridWidth(previous => Math.abs(previous - width) > 1 ? width : previous);
      }}>
        {ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            testID={`action-${action.key}`}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => onAction(action.key)}
            style={({ pressed }) => [styles.tile, styles.quickTile, { width: fourQuickColumns ? "23.5%" : "48.5%", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <VectorSymbol name={action.symbol} size={75} />
            <AppText numberOfLines={2} style={[styles.tileLabel, { color: colors.onSurface }]}>{action.label}</AppText>
          </Pressable>
        ))}
      </View>
    </Card>
  );

  const tools = (
    <Card testID="customer-module-grid" style={styles.groupCard}>
      <AppText style={[styles.sectionTitle, { color: colors.onSurface }]}>RMC Tools</AppText>
      <View style={styles.grid}>
        {CUSTOMER_MODULES.map(module => (
          <Pressable
            key={module.key}
            testID={`customer-module-${module.key}`}
            accessibilityRole="button"
            accessibilityLabel={module.label}
            onPress={() => router.push(module.route)}
            style={({ pressed }) => [styles.tile, { width: "23.5%", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
          >
            {module.symbol ? <VectorSymbol name={module.symbol} size={52} /> : <Ionicons name={module.icon} size={52} color={colors.brand} />}
            <AppText numberOfLines={3} style={[styles.tileLabel, { color: colors.onSurface }]}>{module.key === "projects" ? "Project Hub" : module.label}</AppText>
          </Pressable>
        ))}
      </View>
    </Card>
  );

  const otherServices = (
    <Card testID="home-other-services" style={styles.groupCard}>
      <AppText style={[styles.sectionTitle, { color: colors.onSurface }]}>Other Services</AppText>
      <View style={styles.grid}>
        {SERVICES.map(service => (
          <Pressable
            key={service.key}
            testID={`service-${service.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${service.label} enquiry`}
            onPress={() => openService(service.key)}
            style={({ pressed }) => [styles.tile, { width: "31.5%", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <VectorSymbol name={service.symbol} size={58} />
            <AppText numberOfLines={2} style={[styles.serviceLabel, { color: colors.onSurface }]}>{service.label}</AppText>
          </Pressable>
        ))}
      </View>
      <AppText variant="caption" style={{ textAlign: "center" }}>Send an enquiry; our team will contact you.</AppText>
    </Card>
  );

  return (
    <ThemedScreen>
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <CustomerHomeHeader onRefreshHome={refetch} />

      <ScrollView
        testID="customer-home-scroll"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}
      >
        {error && !data ? (
          <>
            <ErrorView message={error} onRetry={reload} />
            {quickActions}
            <KycBanner status={user?.kyc_status || "NOT_STARTED"} />
            {tools}
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
            {/* Approved five-image promotional carousel. */}
            <HomeCarousel />
            {quickActions}
            <KycBanner status={data.kyc_status} />
            {tools}
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 190, gap: 14, maxWidth: 1100, alignSelf: "center", width: "100%" },
  groupCard: { padding: 12, gap: 12 },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 19, paddingHorizontal: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", width: "100%", justifyContent: "space-between", rowGap: 8 },
  tile: { minHeight: 120, alignItems: "center", justifyContent: "flex-start", paddingHorizontal: 3, paddingVertical: 8, gap: 7, borderWidth: 1, borderRadius: radius.md },
  quickTile: { minHeight: 132 },
  tileLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, textAlign: "center" },
  serviceLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, textAlign: "center" },
});
