import React, { useCallback } from "react";
import { Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { HomeScroll } from "@/src/components/HomeScroll";
import { PlantHomeBanner, PlantHomeHero } from "@/src/components/PlantHomeCards";
import { AppText } from "@/src/components/ui/AppText";
import { ErrorView } from "@/src/components/StateViews";
import { type VectorSymbolName } from "@/src/components/VectorSymbol";
import { IconTile } from "@/src/components/IconTile";
import { fonts } from "@/src/theme/tokens";
import { useTheme } from "@/src/theme/ThemeProvider";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { HOME_SHORTCUTS } from "@/src/owner/modules";
import { OwnerFrame, OwnerGlass, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";

import { LoadPipeline, WorkspaceTile, businessPath, pipelinePath, recordPath, usePlantWorkspace } from "@/src/owner/PlantOperations";

export default function OwnerHome() {
  const p = useOwnerPalette();
  const { colors } = useTheme();
  const bottom = useOwnerBottomSpace();
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const contentWidth = Math.max(0, Math.min(viewportWidth - 32, styles.homeCards.maxWidth));
  const { plant, loading: plantsLoading, error: plantsError, reload: retryPlants, refetch: refreshPlants } = usePlantWorkspace();
  const readableWidth = contentWidth / fontScale;
  const taskWidth = readableWidth >= 400 ? "23.5%" : readableWidth >= 200 ? "49%" : "100%";
  const shortcutWidth = Math.min(Math.ceil(88 * fontScale), Math.max(0, contentWidth - 12));
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
    <HomeScroll testID="owner-home-scroll" paddingHorizontal={16} gap={10}
      contentContainerStyle={{ paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={plantsLoading && !!plant} onRefresh={() => void retryPlants()} tintColor={p.accent} />}
    >
      <View testID="owner-home-summary" style={[styles.homeCards, styles.hero, { backgroundColor: p.panel }]}>
        <PlantHomeHero label="Plant Owner" testID="owner-home-hero-banner" profile={profile} minHeight={Math.ceil(152 * fontScale)} />
      </View>
      <View style={styles.homeCards}>
        <OwnerGlass testID="owner-quick-access" style={styles.quickAccess} highlighted={false}>
          <View style={styles.rail}>
            {modules.map(module => <Pressable testID={`owner-shortcut-${module.key}`} key={module.key}
              accessibilityRole="button" accessibilityLabel={module.label} accessibilityHint={module.description}
              onPress={() => router.push(plantShortcut(module))}
              style={({ pressed }) => [styles.shortcut, { width: shortcutWidth, opacity: pressed ? 0.74 : 1,
                backgroundColor: colors.surface, borderColor: p.border }]}>
              {module.symbol ? <IconTile symbol={module.symbol} size={23} width={35} height={34} homeShortcut /> : <IconTile icon={module.icon} homeShortcut />}
              <AppText center style={styles.quickLabel}>{module.label}</AppText>
            </Pressable>)}
          </View>
        </OwnerGlass>
        <View style={styles.rail}>
          <View style={{ width: Math.min(contentWidth, Math.ceil(156 * fontScale)) }}>
            <WorkspaceTile testID="plant-home-supplier-enquiry" title="Material Suppliers" symbol="supplier-enquiry" destination="/supplier-enquiry" tone="warning" />
          </View>
          <View style={{ width: Math.min(contentWidth, Math.ceil(167 * fontScale)) }}>
            <WorkspaceTile title="Dispatch Automation" symbol="automation" destination={operations("automation")} tone="approval" />
          </View>
          <View style={{ width: Math.min(contentWidth, Math.ceil(141 * fontScale)) }}>
            <WorkspaceTile title="Daily Overview" symbol="plant-reports" destination={plant ? businessPath("reports", plant.id) : "/business/reports"} />
          </View>
        </View>
        <View style={styles.taskGrid}>
          {[
            { title: "Pending Orders", symbol: "pending-approval", route: { pathname: "/owner/orders", params: { status: "pending", today: "" } } },
            { title: "Production & Dispatch", symbol: "production-and-dispatch", route: plant ? pipelinePath(plant.id) : { pathname: "/owner/orders", params: { status: "processing", today: "" } } },
            ...(plant ? [{ title: "DC Book", symbol: "delivery-challan" as const, route: recordPath("challans", plant.id) }] : []),
            { title: "Scheduled Volume", symbol: "production-report", route: { pathname: "/owner/orders", params: { status: "all", today: "1" } } },
          ].map(task => <View key={task.title} style={{ width: taskWidth }}>
            <WorkspaceTile stacked title={task.title} symbol={task.symbol as VectorSymbolName} destination={task.route as Href} />
          </View>)}
        </View>
        <OwnerGlass style={styles.banners} highlighted={false}>
          <PlantHomeBanner type="attendance" destination={plant ? businessPath("attendance", plant.id) : "/workforce"} />
          <PlantHomeBanner type="whatsapp" destination={operations("whatsapp")} />
        </OwnerGlass>
        <View style={[styles.cardRow, readableWidth < 310 && styles.stacked]}>
          <WorkspaceTile title="Billing & Ledger" symbol="billing-and-ledger" destination="/owner/billing" />
          {plant ? <WorkspaceTile title="Public Plant Profile" symbol="plant-profile"
            destination={{ pathname: "/plant-profile", params: { plantId: plant.id } }} /> : null}
        </View>
        {plantsError ? <ErrorView message={plantsError} onRetry={retryPlants} /> : null}
        {plant ? <LoadPipeline plantId={plant.id} plantName={plant.name} contentWidth={contentWidth} /> : !plantsError ? <AppText variant="caption">
          {plantsLoading ? "Loading plants…" : "Load Pipeline will appear once a plant is assigned."}
        </AppText> : null}
      </View>
    </HomeScroll>
  </OwnerFrame>;
}
const styles = StyleSheet.create({
  homeCards: { alignSelf: "center", width: "100%", maxWidth: 620, gap: 10 },
  hero: { borderRadius: 10 },
  quickAccess: { borderRadius: 10, padding: 5 },
  rail: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  taskGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: "2%", rowGap: 6 },
  cardRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  banners: { padding: 4, gap: 4 },
  stacked: { flexDirection: "column" },
  shortcut: { borderWidth: 1, borderRadius: 8, minHeight: 65, paddingHorizontal: 4, paddingVertical: 5, alignItems: "center", gap: 4 },
  quickLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, width: "100%" },
});
