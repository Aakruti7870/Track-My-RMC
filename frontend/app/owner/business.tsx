import { useCallback, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useFocusEffect, type Href } from "expo-router";

import { ErrorView } from "@/src/components/StateViews";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { AppText } from "@/src/components/ui/AppText";
import { useGet } from "@/src/hooks/useApi";
import { OwnerFrame, OwnerGlass, OwnerLinkRow, OwnerList, ui, useOwnerPalette } from "@/src/owner/OwnerUI";
import { PlantSelector, businessPath, recordPath, usePlantWorkspace } from "@/src/owner/PlantOperations";
import { useTheme } from "@/src/theme/ThemeProvider";

const sections = [
  { key: "sales", label: "Sales", symbol: "quotations" },
  { key: "purchase", label: "Purchase", symbol: "purchases" },
  { key: "payments", label: "Payments", symbol: "billing-and-ledger" },
  { key: "profit-loss", label: "Profit & Loss", symbol: "plant-reports" },
] as const;
const periods = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
] as const;

type Section = (typeof sections)[number]["key"];
type Period = (typeof periods)[number]["key"];
type Summary = {
  invoices_issued: number;
  invoiced_sales: string;
  invoice_balance: string;
  purchase_receipts: number;
  purchases_total: string;
  customer_payments: string;
  recorded_expenses: string;
};
type Link = { title: string; route: Href };

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

function sectionLinks(plantId: string): Record<Section, Link[]> {
  return {
    sales: [
      { title: "Plant Orders", route: { pathname: "/owner/orders", params: { plantId } } },
      { title: "Quotation Requests", route: { pathname: "/owner/quotation-requests", params: { plantId } } },
      { title: "Provisional Requests", route: { pathname: "/owner/provisional-requests", params: { plantId } } },
      { title: "Plant Customers", route: businessPath("customers", plantId) },
      { title: "Rate Cards", route: businessPath("rates", plantId) },
    ],
    purchase: [
      { title: "Purchase Receipts", route: businessPath("purchases", plantId) },
      { title: "Suppliers", route: businessPath("suppliers", plantId) },
      { title: "Material Inventory", route: businessPath("inventory", plantId) },
    ],
    payments: [
      { title: "Billing & Ledger", route: { pathname: "/owner/billing", params: { plantId } } },
      { title: "Plant Ledger", route: recordPath("ledger", plantId) },
    ],
    "profit-loss": [
      { title: "Expenses", route: businessPath("expenses", plantId) },
      { title: "Stock & Consumption", route: recordPath("consumption", plantId) },
      { title: "Plant Reports", route: businessPath("reports", plantId) },
    ],
  };
}

function sectionMetrics(data: Summary): Record<Section, { label: string; value: string }[]> {
  const sales = { label: "Invoiced sales excl. GST", value: currency.format(Number(data.invoiced_sales)) };
  return {
    sales: [{ label: "Invoices issued", value: String(data.invoices_issued) }, sales],
    purchase: [
      { label: "Purchase receipts", value: String(data.purchase_receipts) },
      { label: "Recorded purchases incl. GST", value: currency.format(Number(data.purchases_total)) },
    ],
    payments: [
      { label: "Recorded customer receipts", value: currency.format(Number(data.customer_payments)) },
      { label: "Unpaid on period invoices", value: currency.format(Number(data.invoice_balance)) },
    ],
    "profit-loss": [
      sales, { label: "Recorded expenses", value: currency.format(Number(data.recorded_expenses)) },
    ],
  };
}

export default function OwnerBusiness() {
  const p = useOwnerPalette();
  const { colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const readableWidth = (Math.min(width, 820) - 32) / fontScale;
  const oneColumn = readableWidth < 195;
  const [section, setSection] = useState<Section>("sales");
  const [period, setPeriod] = useState<Period>("this_month");
  const [plantsOpen, setPlantsOpen] = useState(false);
  const workspace = usePlantWorkspace();
  const plant = workspace.plant;
  const { refetch: refreshPlants } = workspace;
  const { data, loading, error, reload, refetch } = useGet<Summary>(
    plant ? `/owner/plants/${encodeURIComponent(plant.id)}/business-summary?period=${period}` : null,
  );
  useFocusEffect(useCallback(() => {
    void refreshPlants();
    void refetch();
  }, [refreshPlants, refetch]));
  const active = sections.find(item => item.key === section);
  const links = plant ? sectionLinks(plant.id)[section] : [];
  const metrics = data ? sectionMetrics(data)[section] : [];

  return <OwnerFrame matte title="Business">
    <OwnerList reserveNavigation>
      <View testID="owner-business-workspace" style={styles.workspace}>
        {workspace.error ? <ErrorView message={workspace.error} onRetry={workspace.reload} /> : null}
        {workspace.loading && !plant ? <AppText variant="caption">Loading plants…</AppText> : null}
        {!workspace.loading && !workspace.error && !plant ?
          <AppText variant="bodyMuted">No active plant is assigned.</AppText> : null}
        {plant ? <View style={styles.controls}>
          <Pressable testID="owner-business-plant" accessibilityRole="button"
            accessibilityLabel={plant.name} accessibilityState={{ expanded: plantsOpen, disabled: workspace.plants.length < 2 }}
            disabled={workspace.plants.length < 2} onPress={() => setPlantsOpen(open => !open)}
            style={{ flexBasis: readableWidth >= 315 ? 130 : "100%", flexGrow: 1, minWidth: 0 }}>
            <OwnerGlass highlighted={false} style={[styles.period, styles.plant]}>
              <AppText variant="label" style={{ flex: 1 }}>{plant.name}</AppText>
              {workspace.plants.length > 1 ? <VectorSymbol name="chevron-down" size={18} color={p.text} /> : null}
            </OwnerGlass>
          </Pressable>
          {periods.map(item => <Pressable key={item.key} testID={`owner-business-period-${item.key}`}
            accessibilityRole="button" accessibilityState={{ selected: period === item.key }}
            onPress={() => setPeriod(item.key)}>
            <OwnerGlass highlighted={false} style={[styles.period, period === item.key && { backgroundColor: colors.brandSoft, borderColor: p.accent }]}>
              <AppText style={{ fontSize: 12 }}>{item.label}</AppText>
            </OwnerGlass>
          </Pressable>)}
        </View> : null}
        {plant && plantsOpen && workspace.plants.length > 1 ? <PlantSelector plants={workspace.plants}
          plant={plant} select={id => { workspace.setSelection(id); setPlantsOpen(false); }} /> : null}
        <View style={styles.grid}>
          {sections.map(item => <Pressable key={item.key} testID={`owner-business-card-${item.key}`}
            accessibilityRole="button" accessibilityState={{ selected: section === item.key }}
            onPress={() => setSection(item.key)} style={{ width: oneColumn ? "100%" : "49%" }}>
            <OwnerGlass highlighted={false} style={[styles.sectionCard, section === item.key && { backgroundColor: colors.brandSoft, borderColor: p.accent }]}>
              <VectorSymbol name={item.symbol} size={26} color={p.text} />
              <AppText variant="label" center>{item.label}</AppText>
            </OwnerGlass>
          </Pressable>)}
        </View>
        {plant ? <OwnerGlass testID="owner-business-results" highlighted={false} style={ui.group}>
          <AppText accessibilityRole="header" style={[ui.groupHeading, { backgroundColor: p.canvas }]}>{active?.label}</AppText>
          <View style={[styles.results, { borderColor: p.border }]}>
            {loading && !data ? <AppText variant="caption">Loading results…</AppText> : null}
            {error ? <ErrorView message={error} onRetry={reload} /> : null}
            {data ? <View style={styles.grid}>
              {metrics.map((item, index) => <View key={item.label}
                style={{ width: oneColumn ? "100%" : "49%", minWidth: 0, paddingLeft: index && !oneColumn ? 10 : 0,
                  borderLeftWidth: index && !oneColumn ? StyleSheet.hairlineWidth : 0, borderColor: p.border }}>
                <AppText variant="heading">{item.value}</AppText>
                <AppText variant="caption">{item.label}</AppText>
              </View>)}
            </View> : null}
            {section === "profit-loss" ? <AppText variant="bodyMuted">
              Net profit needs valued material consumption and closing adjustments.
            </AppText> : null}
          </View>
          <View style={ui.groupRows}>
            {links.map((link, index) => <OwnerLinkRow key={link.title} title={link.title} route={link.route} divider={index > 0} />)}
          </View>
        </OwnerGlass> : null}
      </View>
    </OwnerList>
  </OwnerFrame>;
}

const styles = StyleSheet.create({
  workspace: { gap: 10 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  period: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 6 },
  plant: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "2%", rowGap: 8 },
  sectionCard: { flex: 1, minHeight: 94, justifyContent: "center", alignItems: "center", gap: 4, padding: 8 },
  results: { gap: 8, paddingHorizontal: 13, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
