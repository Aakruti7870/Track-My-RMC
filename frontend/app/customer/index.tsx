import React from "react";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { LiveMap } from "@/src/components/LiveMap";
import { KycBanner } from "@/src/components/KycBanner";
import { ErrorView } from "@/src/components/StateViews";
import { HomeCarousel } from "@/src/components/HomeCarousel";
import { OrderData } from "@/src/components/OrderCard";
import { PlantData } from "@/src/components/PlantCard";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";
import { customerHomeModules } from "@/src/navigation/moduleCatalog";



type HomeData = {
  name: string;
  kyc_status: string;
  active_order: OrderData | null;
  recent_orders: OrderData[];
  nearby_plants: PlantData[];
  unread_notifications: number;
};
type ActiveTracking = { active: boolean; status: string; tm_number?: string; driver_mobile?: string; location?: {lat:number;lng:number;at:string}|null; active_loads?: Array<{id:string;status:string;tm_number?:string;driver_mobile?:string;location?:{lat:number;lng:number;at:string}|null}>; origin?:{lat?:number;lng?:number}; destination?:{lat?:number;lng?:number}; };

const ACTIONS: { key: "new" | "track" | "plants" | "orders"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "new", label: "New Order", icon: "add" },
  { key: "track", label: "Track Order", icon: "navigate" },
  { key: "plants", label: "Available Plants", icon: "location" },
  { key: "orders", label: "My Orders", icon: "document-text" },
];

const CUSTOMER_MODULES = customerHomeModules();
const ACTION_SYMBOLS: Record<string, VectorSymbolName> = {
  new: "new-order", track: "live-order-tracking",
  plants: "nearby-rmc-plants", orders: "my-orders",
};

export default function CustomerHome() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<HomeData>("/customer/home");
  const activeId = data?.active_order?.id;
  const {data: tracking} = useGet<ActiveTracking>(activeId ? `/customer/orders/${activeId}/tracking` : null);
  const liveLoad = tracking?.active_loads?.find(load=>load.location) || tracking?.active_loads?.[0];
  const liveLocation = liveLoad?.location || tracking?.location;
  const isFresh = Boolean(liveLocation?.at && Date.now()-new Date(liveLocation.at).getTime()<90000);
  const canShowLive = Boolean(tracking?.active && liveLocation && isFresh);
  const dial = async (number?:string|null) => {
    if (!number) return toast("Contact number not available for this trip", "info");
    const normalized=number.replace(/[\\s()-]/g,"");
    if (!/^\\+?[0-9]{7,15}$/.test(normalized)) return toast("Invalid contact number", "info");
    try { await Linking.openURL(`tel:${normalized}`); } catch { toast("Unable to open phone dialer", "error"); }
  };

  const openActiveTracking = () => {
    if (!data?.active_order) {
      toast("No active order to track", "info");
      return;
    }
    router.push(`/track/${data.active_order.id}` as any);
  };

  const onAction = (key: (typeof ACTIONS)[number]["key"]) => {
    if (key === "track") return openActiveTracking();
    if (key === "plants") return router.push("/customer/plants");
    if (key === "orders") return router.push("/customer/orders");
    if (data?.kyc_status !== "VERIFIED") {
      toast("Complete KYC to place an order", "info");
      return router.push("/kyc");
    }
    return router.push("/new-order");
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}> 
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <View style={styles.wordmark}>
          <AppText style={[styles.wordmarkSmall, { color: colors.onSurface }]}>TRACK MY</AppText>
          <AppText style={[styles.wordmarkBig, { color: colors.onSurface }]}>RMC</AppText>
        </View>
        <View style={styles.headerRight}>
          {data?.kyc_status === "VERIFIED" ? (
            <View style={[styles.verifiedPill, { borderColor: colors.verified, backgroundColor: colors.verified + "10" }]}> 
              <AppText style={[styles.verifiedText, { color: colors.verified }]}>KYC VERIFIED</AppText>
              <Ionicons name="checkmark-circle" size={19} color={colors.verified} />
            </View>
          ) : (
            <Pressable testID="header-kyc" onPress={() => router.push("/kyc")} style={[styles.kycPending, { borderColor: colors.border }]}> 
              <AppText variant="label">KYC</AppText>
            </Pressable>
          )}
          <Pressable testID="notifications-bell" onPress={() => router.push("/notifications")} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}> 
            <Ionicons name="notifications-outline" size={22} color={colors.onSurface} />
            {data && data.unread_notifications > 0 ? <View style={[styles.dot, { backgroundColor: colors.brand }]} /> : null}
          </Pressable>
        </View>
      </View>

      {error && !data ? (
        <ScrollView
          testID="customer-home-scroll"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <ErrorView message={error} onRetry={reload} />
          <View style={styles.section} testID="customer-module-grid">
            <View style={styles.rowBetween}>
              <AppText style={[styles.sectionTitle, { color: colors.onSurface }]}>Site & Quality Tools</AppText>
              <Pressable testID="view-all-customer-modules" onPress={() => router.push("/customer/more")}>
                <AppText variant="label" color={colors.brand}>All tools  ›</AppText>
              </Pressable>
            </View>
            <View style={styles.moduleGrid}>
              {CUSTOMER_MODULES.map((module) => (
                <Pressable
                  key={module.key}
                  testID={`customer-module-${module.key}`}
                  onPress={() => router.push(module.route)}
                  style={({ pressed }) => [
                    styles.moduleCard,
                    {
                      backgroundColor: colors.surfaceSecondary,
                      borderColor: colors.border,
                      opacity: pressed ? 0.82 : 1,
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    },
                  ]}
                >
                  <View style={[styles.moduleIcon, { backgroundColor: colors.brandSoft }]}>
                    {module.symbol ? <VectorSymbol name={module.symbol} size={34} /> : <Ionicons name={module.icon} size={22} color={colors.brand} />}
                  </View>
                  <AppText style={[styles.moduleLabel, { color: colors.onSurface }]}>{module.label}</AppText>
                  
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          testID="customer-home-scroll"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}
        >
          {loading && !data ? (
            <>
              <Skeleton height={430} style={{ borderRadius: radius.xl }} />
              <Skeleton height={122} style={{ borderRadius: radius.lg }} />
              <Skeleton height={250} style={{ borderRadius: radius.lg }} />
            </>
          ) : data ? (
            <>
              <HomeCarousel />

              {data.kyc_status !== "VERIFIED" ? <KycBanner status={data.kyc_status} /> : null}

              <View style={styles.section}>
                <AppText style={[styles.sectionTitle, { color: colors.onSurface }]}>Quick Actions</AppText>
                <View style={styles.actionGrid}>
                  {ACTIONS.map((action, index) => (
                    <Pressable
                      key={action.key}
                      testID={`action-${action.key}`}
                      onPress={() => onAction(action.key)}
                      style={({ pressed }) => [
                        styles.action,
                        {
                          backgroundColor: index === 0 ? colors.brandSoft : colors.surfaceSecondary,
                          borderColor: index === 0 ? colors.brand + "3D" : colors.border,
                          opacity: pressed ? 0.82 : 1,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                        },
                      ]}
                    >
                      <View style={[styles.actionIcon, { backgroundColor: index === 0 ? colors.brand : colors.surfaceTertiary }]}> 
                        <VectorSymbol name={ACTION_SYMBOLS[action.key]} size={38} />
                      </View>
                      <AppText style={[styles.actionLabel, { color: colors.onSurface }]}>{action.label}</AppText>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.section} testID="customer-module-grid">
                <View style={styles.rowBetween}>
                  <AppText style={[styles.sectionTitle, { color: colors.onSurface }]}>Your Modules</AppText>
                  <Pressable testID="view-all-customer-modules" onPress={() => router.push("/customer/more")}>
                    <AppText variant="label" color={colors.brand}>All tools  ›</AppText>
                  </Pressable>
                </View>
                <View style={styles.moduleGrid}>
                  {CUSTOMER_MODULES.map((module) => (
                    <Pressable
                      key={module.key}
                      testID={`customer-module-${module.key}`}
                      onPress={() => router.push(module.route)}
                      style={({ pressed }) => [
                        styles.moduleCard,
                        {
                          backgroundColor: colors.surfaceSecondary,
                          borderColor: colors.border,
                          opacity: pressed ? 0.82 : 1,
                          transform: [{ scale: pressed ? 0.985 : 1 }],
                        },
                      ]}
                    >
                      <View style={[styles.moduleIcon, { backgroundColor: colors.brandSoft }]}>
                        {module.symbol ? <VectorSymbol name={module.symbol} size={34} /> : <Ionicons name={module.icon} size={22} color={colors.brand} />}
                      </View>
                      <AppText style={[styles.moduleLabel, { color: colors.onSurface }]}>{module.label}</AppText>
                      
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <View style={styles.rowBetween}>
                  <AppText style={[styles.sectionTitle, { color: colors.onSurface }]}>Active Transit Mixer Live Tracking</AppText>
                  <Pressable testID="view-all-orders" onPress={() => router.push("/customer/orders")}>
                    <AppText variant="label" color={colors.brand}>View All  ›</AppText>
                  </Pressable>
                </View>
                {data.active_order ? (
                  <>
                  <Card style={styles.activeCard}>
                    <View style={styles.activeInfo}>
                      <View style={styles.rowBetween}>
                        <AppText style={[styles.orderNumber, { color: colors.onSurface }]}>{data.active_order.order_number}</AppText>
                        <View style={styles.statusRow}><View style={[styles.statusDot, { backgroundColor: colors.brand }]} /><AppText style={{ color: colors.brand, fontFamily: fonts.medium }}>{data.active_order.status.replace(/_/g, " ")}</AppText></View>
                      </View>
                      <AppText style={[styles.grade, { color: colors.onSurface }]}>{data.active_order.grade} Grade · {data.active_order.quantity} m³</AppText>
                      <View style={styles.locationRow}><Ionicons name="location-outline" size={17} color={colors.onSurfaceTertiary} /><AppText variant="caption" style={{ flex: 1 }}>{data.active_order.site_name}</AppText></View>
                    </View>
                    <View style={styles.map}>
                      <LiveMap
                        origin={tracking?.origin?.lat != null && tracking.origin.lng != null ? { lat: tracking.origin.lat, lng: tracking.origin.lng } : null}
                        destination={tracking?.destination?.lat != null && tracking.destination.lng != null ? { lat: tracking.destination.lat, lng: tracking.destination.lng } : null}
                        mixer={canShowLive && liveLocation ? { lat: liveLocation.lat, lng: liveLocation.lng } : null}
                        style={{ flex: 1 }}
                      />
                    </View>
                    <View style={styles.trackingDock}>
                      <Pressable testID="home-track-tm" accessibilityRole="button" accessibilityLabel="Track TM" onPress={openActiveTracking} style={styles.trackingAction}>
                        <Ionicons name="navigate-outline" size={22} color={colors.brand} />
                        <AppText style={styles.trackingActionTitle}>Track TM</AppText>
                      </Pressable>
                      <Pressable testID="home-call-driver" accessibilityRole="button" accessibilityLabel="Call Driver" onPress={() => void dial(liveLoad?.driver_mobile || tracking?.driver_mobile)} style={styles.trackingAction}>
                        <Ionicons name="call-outline" size={22} color={colors.brand} />
                        <AppText style={styles.trackingActionTitle}>Call Driver</AppText>
                      </Pressable>
                      <Pressable testID="home-call-plant" accessibilityRole="button" accessibilityLabel="Contact Plant" onPress={() => router.push("/customer/plants")} style={styles.trackingAction}>
                        <Ionicons name="business-outline" size={22} color={colors.brand} />
                        <AppText style={styles.trackingActionTitle}>Contact Plant</AppText>
                      </Pressable>
                    </View>
                    <View style={[styles.metrics, { borderTopColor: colors.divider }]}>
                      <View><AppText variant="caption">GPS status</AppText><AppText style={styles.metricValue}>{canShowLive ? "Live" : liveLocation ? "Last known" : "Awaiting"}</AppText></View>
                      <View><AppText variant="caption">Quantity</AppText><AppText style={styles.metricValue}>{data.active_order.quantity} m³</AppText></View>
                      <Pressable testID="track-active-order" accessibilityRole="button" accessibilityLabel="Track Live" onPress={openActiveTracking} style={({ pressed }) => [styles.trackLive, { backgroundColor: colors.brand, opacity: pressed ? 0.85 : 1 }]}>
                        <Ionicons name="radio-outline" size={18} color={colors.onBrand} />
                        <AppText style={styles.trackLiveText}>Track Live</AppText>
                      </Pressable>
                    </View>
                  </Card>
                  </>
                ) : (
                  <Card style={styles.emptyOrder}>
                    <Ionicons name="cube-outline" size={30} color={colors.onSurfaceTertiary} />
                    <View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold }}>No active delivery</AppText><AppText variant="caption">Your live order will appear here after dispatch.</AppText></View>
                    <Pressable onPress={() => onAction("new")}><Ionicons name="add-circle" size={30} color={colors.brand} /></Pressable>
                  </Card>
                )}
              </View>

              {data.nearby_plants.length > 0 ? (
                <View style={styles.section}>
                  <View style={styles.rowBetween}><AppText style={[styles.sectionTitle, { color: colors.onSurface }]}>Available Plants</AppText><Pressable onPress={() => router.push("/customer/plants")}><AppText variant="label" color={colors.brand}>See all</AppText></Pressable></View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                    {data.nearby_plants.map((p) => (
                      <Pressable key={p.id} onPress={() => router.push("/customer/plants")} style={[styles.plantChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}> 
                        <View style={styles.rowBetween}><Ionicons name="business-outline" size={18} color={colors.brand} />{p.verified ? <Ionicons name="checkmark-circle" size={16} color={colors.verified} /> : null}</View>
                        <AppText style={styles.plantName} numberOfLines={2}>{p.name}</AppText>
                        <AppText variant="caption" numberOfLines={1}>{p.city}</AppText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, paddingTop: 10, paddingBottom: 10 },
  wordmark: { gap: 0 },
  wordmarkSmall: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 1.1, lineHeight: 15 },
  wordmarkBig: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 31, letterSpacing: -0.8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 9 },
  verifiedPill: { height: 42, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  verifiedText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.25 },
  kycPending: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  dot: { position: "absolute", top: 7, right: 7, width: 8, height: 8, borderRadius: 4 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 120, gap: 24 },
  section: { gap: 12 },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 20 },
  actionGrid: { flexDirection: "row", gap: 10 },
  action: { flex: 1, minHeight: 126, borderRadius: 22, borderWidth: 1, padding: 12, alignItems: "center", justifyContent: "center", gap: 10 },
  actionIcon: { width: 54, height: 54, borderRadius: 17, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  actionLabel: { fontFamily: fonts.semibold, fontSize: 12, textAlign: "center" },
  moduleGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  moduleCard: { width: "23%", minHeight: 104, borderRadius: 14, borderWidth: 1, padding: 7, gap: 5, alignItems: "center", justifyContent: "center" },
  moduleIcon: { width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  moduleLabel: { fontFamily: fonts.semibold, fontSize: 10, textAlign: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  activeCard: { padding: 0, overflow: "hidden", borderRadius: 24 },
  activeTop: { flexDirection: "row", minHeight: 186 },
  activeInfo: { padding: 18, gap: 10 },
  orderNumber: { fontFamily: fonts.bold, fontSize: 18 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  grade: { fontFamily: fonts.semibold, fontSize: 14 },
  locationRow: { flexDirection: "row", gap: 5, alignItems: "flex-start" },
  map: { width: "100%", height: 220, overflow: "hidden" },
  metrics: { minHeight: 72, borderTopWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  metricValue: { fontFamily: fonts.bold, fontSize: 15 },
  metricDivider: { width: 1, height: 32 },
  trackLive: { marginLeft: "auto", minHeight: 44, borderRadius: 22, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 7 },
  trackLiveText: { fontFamily: fonts.semibold, color: "#FFFFFF", fontSize: 14 },
  emptyOrder: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18 },
  plantChip: { width: 156, minHeight: 104, gap: 7, padding: 14, borderRadius: 18, borderWidth: 1 },
  plantName: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
  trackingDock: { flexDirection: "row", padding: 10, gap: 8 },
  trackingAction: { flex: 1, minWidth: 0, minHeight: 70, borderColor: "#E2E8F0", borderWidth: 1, borderRadius: 12, padding: 6, alignItems: "center", justifyContent: "center", gap: 5 },
  trackingActionTitle: { fontFamily: fonts.semibold, fontSize: 11, color: "#0F172A", textAlign: "center" },
});
