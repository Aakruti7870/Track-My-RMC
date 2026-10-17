import React from "react";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ActiveTransitMixerCard } from "@/src/components/ActiveTransitMixerCard";
import { KycBanner } from "@/src/components/KycBanner";
import { ErrorView } from "@/src/components/StateViews";
import { HomeCarousel } from "@/src/components/HomeCarousel";
import { OrderData } from "@/src/components/OrderCard";
import { PlantData } from "@/src/components/PlantCard";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";
import { modulesForRole } from "@/src/navigation/moduleCatalog";



type HomeData = {
  name: string;
  kyc_status: string;
  active_order: OrderData | null;
  recent_orders: OrderData[];
  nearby_plants: PlantData[];
  unread_notifications: number;
};
const ACTIONS: { key: "new" | "track" | "plants" | "orders"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "new", label: "New Order", icon: "add" },
  { key: "track", label: "Track Order", icon: "navigate" },
  { key: "plants", label: "Available Plants", icon: "location" },
  { key: "orders", label: "My Orders", icon: "document-text" },
];

// Limit only the Home shortcut strip; all other customer modules stay in More.
// Exactly eight Customer Home shortcuts, in the requested display order.
// This does not change module access or the complete More directory.
const HOME_MODULE_KEYS = [
  "projects",
  "pour-planner",
  "receiving-guide",
  "cube-tests",
  "saved-sites",
  "customer-support",
  "compare-plants",
  "free-tools",
];
const CUSTOMER_DIRECTORY = modulesForRole("customer");
const CUSTOMER_MODULES = HOME_MODULE_KEYS.flatMap(key => CUSTOMER_DIRECTORY.filter(module => module.key === key));
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moduleGrid}>
              {CUSTOMER_MODULES.map((module) => (
                <Pressable
                  key={module.key}
                  testID={`customer-module-${module.key}`}
                  onPress={() => router.push(module.route)}
                  style={({ pressed }) => [
                    styles.moduleCard,
                    {
                      opacity: pressed ? 0.82 : 1,
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    },
                  ]}
                >
                  <View style={[styles.moduleIcon, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                    {module.symbol ? <VectorSymbol name={module.symbol} size={34} /> : <Ionicons name={module.icon} size={22} color={colors.brand} />}
                  </View>
                  <AppText style={[styles.moduleLabel, { color: colors.onSurface }]}>{module.label}</AppText>
                  
                </Pressable>
              ))}
            </ScrollView>
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
                        <VectorSymbol name={ACTION_SYMBOLS[action.key]} size={44} />
                      </View>
                      <AppText style={[styles.actionLabel, { color: colors.onSurface }]}>{action.label}</AppText>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.section} testID="customer-module-grid">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moduleGrid}>
                  {CUSTOMER_MODULES.map((module) => (
                    <Pressable
                      key={module.key}
                      testID={`customer-module-${module.key}`}
                      onPress={() => router.push(module.route)}
                      style={({ pressed }) => [
                        styles.moduleCard,
                        {
                          opacity: pressed ? 0.82 : 1,
                          transform: [{ scale: pressed ? 0.985 : 1 }],
                        },
                      ]}
                    >
                      <View style={[styles.moduleIcon, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                        {module.symbol ? <VectorSymbol name={module.symbol} size={34} /> : <Ionicons name={module.icon} size={22} color={colors.brand} />}
                      </View>
                      <AppText style={[styles.moduleLabel, { color: colors.onSurface }]}>{module.label}</AppText>
                      
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <ActiveTransitMixerCard
                order={data.active_order || data.recent_orders[0] || null}
                onNewOrder={() => onAction("new")}
                onRefreshHome={refetch}
              />

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
  scrollContent: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 220, gap: 24 },
  section: { gap: 12 },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 20 },
  actionGrid: { flexDirection: "row", gap: 10 },
  action: { flex: 1, minHeight: 126, borderRadius: 22, borderWidth: 1, padding: 12, alignItems: "center", justifyContent: "center", gap: 10 },
  actionIcon: { width: 54, height: 54, borderRadius: 17, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  actionLabel: { fontFamily: fonts.semibold, fontSize: 12, textAlign: "center" },
  moduleGrid: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingRight: 18 },
  moduleCard: { width: 80, minHeight: 88, paddingVertical: 0, gap: 6, alignItems: "center", justifyContent: "flex-start" },
  moduleIcon: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  moduleLabel: { fontFamily: fonts.semibold, fontSize: 10, lineHeight: 12, textAlign: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  plantChip: { width: 156, minHeight: 104, gap: 7, padding: 14, borderRadius: 18, borderWidth: 1 },
  plantName: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
});
