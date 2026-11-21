import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ErrorView } from "@/src/components/StateViews";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { RadioChoice } from "@/src/components/ui/RadioChoice";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { OwnerGlass, useOwnerPalette } from "./OwnerUI";
import {
  costingDate, deliveryCostPerM3, latestDieselRate, latestPurchaseRates, materialTotal, nonnegativeNumber, priceMix,
  type DieselEntry, type IngredientKey, type Material, type MixDesign, type PurchaseReceipt,
} from "./rmcCosting";

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
});
const unitRate = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 4,
});

type Choice = { id: string; label: string };

function CostingChoice({ label, selected, options, onChange }: {
  label: string;
  selected?: string;
  options: Choice[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find(option => option.id === selected)?.label;
  return <View style={styles.stack}>
    <Button label={selectedLabel ? `${label}: ${selectedLabel}` : `Select ${label.toLowerCase()}`}
      variant="outline" expanded={open} onPress={() => setOpen(value => !value)} />
    {open ? <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.stack}>
      {options.map(option => <RadioChoice key={option.id} label={option.label} checked={option.id === selected}
        onPress={() => { onChange(option.id); setOpen(false); }} />)}
    </View> : null}
  </View>;
}

function RmcCostingPanel({ plantId }: { plantId: string }) {
  const p = useOwnerPalette();
  const plant = encodeURIComponent(plantId);
  const mixes = useGet<{ mix_designs: MixDesign[] }>(`/master/plants/${plant}/mix-designs`);
  const materials = useGet<{ materials: Material[] }>(`/business/plants/${plant}/materials`);
  const purchases = useGet<{ purchases: PurchaseReceipt[] }>(`/ops/plants/${plant}/purchases`);
  const [mixId, setMixId] = useState<string>();
  const [materialIds, setMaterialIds] = useState<Partial<Record<IngredientKey, string>>>({});
  const [ratesOpen, setRatesOpen] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [overheadInput, setOverheadInput] = useState("");
  const [distance, setDistance] = useState("");
  const [load, setLoad] = useState("");
  const [efficiency, setEfficiency] = useState("");
  const [manualDiesel, setManualDiesel] = useState("");
  const [otherTripCosts, setOtherTripCosts] = useState("");
  const diesel = useGet<{ transactions: DieselEntry[] }>(tripOpen ? `/ops/plants/${plant}/diesel` : null);
  const today = costingDate();
  const catalogue = materials.data?.materials;
  const receipts = purchases.data?.purchases;
  const rates = useMemo(() => latestPurchaseRates(receipts ?? [], catalogue ?? [], today), [receipts, catalogue, today]);
  const mixOptions = (mixes.data?.mix_designs ?? []).filter(mix => mix.active);
  const mix = mixOptions.find(option => option.id === mixId);
  const materialOptions = (catalogue ?? []).map(material => ({ id: material.id, label: `${material.name} (${material.unit})` }));
  const lines = mix ? priceMix(mix, catalogue ?? [], rates, materialIds) : [];
  const materialsCost = materialTotal(lines);
  const overhead = nonnegativeNumber(overheadInput);
  const dieselRate = latestDieselRate(diesel.data?.transactions ?? [], today);
  const tripCost = tripOpen && !diesel.loading
    ? deliveryCostPerM3(distance, load, efficiency, dieselRate?.rate_per_litre ?? manualDiesel, otherTripCosts)
    : null;
  const total = materialsCost === null || overhead === null || (tripOpen && tripCost === null)
    ? null : materialsCost + overhead + (tripCost ?? 0);

  const error = mixes.error ?? materials.error ?? purchases.error;
  if (error) return <ErrorView message={error} onRetry={() => {
    void mixes.reload();
    void materials.reload();
    void purchases.reload();
  }} />;
  if (mixes.loading || materials.loading || purchases.loading) {
    return <AppText variant="caption" center>Loading mix designs and purchase rates…</AppText>;
  }
  if (!mixOptions.length) return <AppText variant="bodyMuted" center>No active mix designs for this plant.</AppText>;

  return <OwnerGlass highlighted={false} style={styles.panel} testID="owner-rmc-costing-panel">
    <CostingChoice label="Mix design" selected={mixId}
      options={mixOptions.map(option => ({ id: option.id, label: `${option.grade} · Mix V${option.version}` }))}
      onChange={id => { setMixId(id); setMaterialIds({}); }} />

    {mix ? <>
      <View accessible accessibilityLiveRegion="polite" style={[styles.estimate, { backgroundColor: p.canvas }]}>
        <AppText variant="caption">{tripOpen ? "Estimated delivered cost" : "Estimated ex-plant cost"}</AppText>
        <AppText variant="heading" testID="owner-rmc-costing-total">
          {total !== null && Number.isFinite(total) ? `${rupees.format(total)} / m³` : "—"}
        </AppText>
        <AppText variant="caption">Materials {materialsCost === null ? "—" : rupees.format(materialsCost)} / m³</AppText>
        {tripOpen ? <AppText variant="caption">Delivery {tripCost === null ? "—" : rupees.format(tripCost)} / m³</AppText> : null}
      </View>

      {materialsCost === null ? <AppText variant="bodyMuted">
        {lines.length ? "Complete the material rates below to calculate the estimate." : "This mix design has no material quantities."}
      </AppText> : null}

      <Input label="Plant overhead (₹/m³)" value={overheadInput} onChangeText={setOverheadInput}
        keyboardType="decimal-pad" hint="Enter 0 to exclude overhead." testID="owner-rmc-overhead" />

      {lines.length ? <Button label={ratesOpen ? "Hide material rates" : "View material rates"}
        variant="ghost" fullWidth={false} expanded={ratesOpen} onPress={() => setRatesOpen(value => !value)} /> : null}

      {ratesOpen ? <View style={styles.stack}>
        <AppText variant="caption">Purchase line rates exclude separately recorded GST and freight.</AppText>
        {lines.map(({ ingredient, quantity, material, rate, cost }) => <View key={ingredient.key}
          style={[styles.material, { borderColor: p.border }]}>
          <AppText variant="label">{ingredient.name}{quantity === null ? "" : ` · ${quantity} ${ingredient.unit}/m³`}</AppText>
          {quantity === null ? <AppText variant="bodyMuted">Invalid mix quantity.</AppText> : <>
            {materialOptions.length ? <CostingChoice label={`${ingredient.name} material`} selected={material?.id}
              options={materialOptions} onChange={id => setMaterialIds(values => ({ ...values, [ingredient.key]: id }))} />
              : <AppText variant="bodyMuted">No inventory materials configured.</AppText>}
            {rate && cost !== null ? <>
              <AppText variant="caption">{unitRate.format(rate.perBaseUnit)} / {ingredient.unit} · {rupees.format(cost)} / m³</AppText>
              <AppText variant="caption">
                {rate.receipt.receipt_number} · {rate.receipt.receipt_date}{rate.usesInventoryUnit ? " · Inventory unit used" : ""}
              </AppText>
            </> : material ? <AppText variant="bodyMuted">No purchase rate convertible to {ingredient.unit}.</AppText> : null}
          </>}
        </View>)}
      </View> : null}

      <Button label={tripOpen ? "Remove delivery estimate" : "Add delivery estimate"} variant="ghost"
        fullWidth={false} expanded={tripOpen} onPress={() => setTripOpen(value => !value)} />
      {tripOpen ? <View style={styles.stack}>
        <View style={styles.tripFields}>
          <View style={styles.tripField}><Input label="Round trip (km)" value={distance} onChangeText={setDistance} keyboardType="decimal-pad" /></View>
          <View style={styles.tripField}><Input label="Mixer load (m³)" value={load} onChangeText={setLoad} keyboardType="decimal-pad" /></View>
          <View style={styles.tripField}><Input label="Mixer efficiency (km/L)" value={efficiency} onChangeText={setEfficiency} keyboardType="decimal-pad" /></View>
          <View style={styles.tripField}><Input label="Other trip costs (₹)" value={otherTripCosts} onChangeText={setOtherTripCosts} keyboardType="decimal-pad" placeholder="Optional" /></View>
        </View>
        {diesel.loading ? <AppText variant="caption">Loading diesel rate…</AppText>
          : dieselRate ? <AppText variant="caption">
            Diesel {unitRate.format(Number(dieselRate.rate_per_litre))}/L · {dieselRate.transaction_date}
          </AppText> : <Input label="Diesel rate (₹/L)" value={manualDiesel} onChangeText={setManualDiesel} keyboardType="decimal-pad"
            hint={diesel.error ? "Diesel ledger unavailable. Enter the rate for this estimate." : "No usable diesel purchase rate recorded."} />}
      </View> : null}
    </> : <AppText variant="caption">Choose the mix version your plant has confirmed.</AppText>}
  </OwnerGlass>;
}

export function OwnerRmcCosting({ plantId }: { plantId: string }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  return <View style={styles.module}>
    <Button label="RMC Costing" fullWidth={false} expanded={open} testID="owner-rmc-costing-toggle"
      onPress={() => setOpen(value => !value)} style={styles.center}
      icon={<Ionicons name="cash-outline" size={20} color={colors.onBrand} accessible={false} />} />
    {open ? <RmcCostingPanel plantId={plantId} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  module: { paddingHorizontal: 12, paddingTop: 10, gap: 10 },
  center: { alignSelf: "center" },
  panel: { padding: 10, gap: 8 },
  stack: { gap: 6 },
  estimate: { padding: 10, gap: 4, borderRadius: 8 },
  material: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 7, gap: 5 },
  tripFields: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tripField: { flexGrow: 1, flexBasis: 138, minWidth: 0 },
});
