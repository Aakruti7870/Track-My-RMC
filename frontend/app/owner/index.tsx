import React, { useCallback } from "react";
import { Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/AuthContext";
import { HomeScroll } from "@/src/components/HomeScroll";
import { PlantHomeBanner, PlantHomeHero } from "@/src/components/PlantHomeCards";
import { AppText } from "@/src/components/ui/AppText";
import { HomeCardRow } from "@/src/components/HomeCardRow";
import { ErrorView } from "@/src/components/StateViews";
import { type VectorSymbolName } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { fonts } from "@/src/theme/tokens";
import { useTheme } from "@/src/theme/ThemeProvider";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { DealerCards } from "@/src/owner/DealerCards";
import { HOME_SHORTCUTS } from "@/src/owner/modules";
import { OwnerFrame, OwnerGlass, ui, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";

import { LoadPipeline, WorkspaceTile, businessPath, pipelinePath, recordPath, usePlantWorkspace } from "@/src/owner/PlantOperations";

const QUICK_GAP = 7;

export default function OwnerHome() {
  const p = useOwnerPalette();
  const { colors } = useTheme();
  const bottom = useOwnerBottomSpace();
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const horizontalPadding = Math.max(ui.content.paddingHorizontal, insets.left, insets.right);
  const compactHeight = (height - bottom) / fontScale < 395;
  const heroMinHeight = Math.ceil(152 * fontScale);
  const { plant, loading: plantsLoading, error: plantsError, reload: retryPlants, refetch: refreshPlants } = usePlantWorkspace();
  const { user } = useAuth();
  const router = useRouter();
  const catalog = modulesForRole(user?.role);
  const modules = HOME_SHORTCUTS.flatMap(([key, label]) => catalog.filter(module => module.key === key).map(module => ({ ...module, label })));
  useFocusEffect(useCallback(() => { void refreshPlants(); }, [refreshPlants]));
  const operations = (section = ""): Href => ({ pathname: "/owner/operations", params: { section, plantId: plant?.id ?? "" } });
  const profile: Href = { pathname: "/plant-profile", params: { assigned: "1", ...(plant ? { plantId: plant.id } : {}) } };
  const plantShortcut = (module: typeof modules[number]): Href => {
    if (!plant) return module.route;
    switch (module.key) {
      case "business-inventory": return businessPath("inventory", plant.id);
      case "business-reports": return businessPath("reports", plant.id);
      case "business-fleet": return businessPath("fleet", plant.id);
      case "business-quotations": return businessPath("quotations", plant.id);
      default: return module.route;
    }
  };

  return <OwnerFrame matte>
    <HomeScroll testID="owner-home-scroll" paddingHorizontal={horizontalPadding} gap={10}
      style={compactHeight ? { marginBottom: bottom } : undefined}
      contentContainerStyle={{ paddingBottom: compactHeight ? 12 : bottom }}
      refreshControl={<RefreshControl refreshing={plantsLoading && !!plant} onRefresh={() => { void retryPlants(); }} tintColor={p.accent} />}
    >
      <View testID="owner-home-summary" style={[styles.homeCards, styles.hero, { backgroundColor: p.panel }]}>
        <PlantHomeHero label="Plant Owner" testID="owner-home-hero-banner" profile={profile}
          minHeight={heroMinHeight} maxHeight={compactHeight ? heroMinHeight : Math.max(heroMinHeight, 215)} />
      </View>
      <View style={styles.homeCards}>
        <OwnerGlass testID="owner-quick-access" style={styles.quickAccess} highlighted={false}>
          <HomeCardRow testID="owner-quick-access-row" label="Quick access" minCardWidth={100} gap={QUICK_GAP}>
            {modules.map(module => <Pressable testID={`owner-shortcut-${module.key}`} key={module.key}
              accessibilityRole="button" accessibilityLabel={module.label} accessibilityHint={module.description}
              onPress={() => router.push(plantShortcut(module))}
              style={({ pressed }) => [styles.shortcut, { opacity: pressed ? 0.74 : 1,
                backgroundColor: colors.surface, borderColor: p.border }]}>
              {module.symbol ? <IconTile symbol={module.symbol} size={23} width={35} height={34} homeShortcut /> : <IconTile icon={module.icon} homeShortcut />}
              <AppText center style={styles.quickLabel}>{module.label}</AppText>
            </Pressable>)}
          </HomeCardRow>
        </OwnerGlass>
        <HomeCardRow testID="owner-home-services-row" label="Plant services" minCardWidth={170}>
          <WorkspaceTile testID="plant-home-supplier-enquiry" title="Material Suppliers" symbol="supplier-enquiry" destination="/supplier-enquiry" tone="warning" />
          <WorkspaceTile title="Dispatch Automation" symbol="automation" destination={operations("automation")} tone="approval" />
          <WorkspaceTile title="Daily Overview" symbol="plant-reports" destination={plant ? businessPath("reports", plant.id) : "/business/reports"} />
        </HomeCardRow>
        <HomeCardRow testID="owner-home-operations-row" label="Plant operations" minCardWidth={138}>
          {[
            { title: "Pending Orders", symbol: "pending-approval", route: { pathname: "/owner/orders", params: { status: "pending", today: "" } } },
            { title: "Production & Dispatch", symbol: "production-and-dispatch", route: plant ? pipelinePath(plant.id) : { pathname: "/owner/orders", params: { status: "processing", today: "" } } },
            ...(plant ? [{ title: "DC Book", symbol: "delivery-challan" as const, route: recordPath("challans", plant.id) }] : []),
            { title: "Scheduled Volume", symbol: "production-report", route: { pathname: "/owner/orders", params: { status: "all", today: "1" } } },
          ].map(task => <WorkspaceTile key={task.title} stacked title={task.title} symbol={task.symbol as VectorSymbolName} destination={task.route as Href} />)}
        </HomeCardRow>
        <OwnerGlass style={styles.banners} highlighted={false}>
          <HomeCardRow testID="owner-home-banners-row" label="Attendance and dispatch services" minCardWidth={244}>
            <PlantHomeBanner type="attendance" destination={plant ? businessPath("attendance", plant.id) : "/workforce"} />
            <PlantHomeBanner type="whatsapp" destination={operations("whatsapp")} />
          </HomeCardRow>
        </OwnerGlass>
        <HomeCardRow testID="owner-home-plant-row" label="Billing and plant profile" minCardWidth={154}>
          <WorkspaceTile title="Billing & Ledger" symbol="billing-and-ledger" destination="/owner/billing" />
          {plant ? <WorkspaceTile title="Public Plant Profile" symbol="plant-profile"
            destination={{ pathname: "/plant-profile", params: { plantId: plant.id } }} /> : null}
        </HomeCardRow>
        {plantsError ? <ErrorView message={plantsError} onRetry={retryPlants} /> : null}
        {plant ? <LoadPipeline plantId={plant.id} plantName={plant.name} swipe /> : !plantsError ? <AppText variant="caption">
          {plantsLoading ? "Loading plants…" : "Load Pipeline will appear once a plant is assigned."}
        </AppText> : null}
        <DealerCards plantId={plant?.id} />
      </View>
    </HomeScroll>
  </OwnerFrame>;
}
const styles = StyleSheet.create({
  homeCards: { width: "100%", gap: 10 },
  hero: { borderRadius: 10 },
  quickAccess: { borderRadius: 10, padding: 5 },
  banners: { padding: 4 },
  shortcut: { flex: 1, borderWidth: 1, borderRadius: 8, minHeight: 65, paddingHorizontal: 4, paddingVertical: 5, alignItems: "center", justifyContent: "center", gap: 4 },
  quickLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, width: "100%" },
});
