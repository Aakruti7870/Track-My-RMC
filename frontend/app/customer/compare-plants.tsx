import React, { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const GRADES = ["M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60"];
const STORAGE_KEY = "trackmyrmc:free-tools:v1";

type Site = { id: string; name: string; address: string; lat?: number | null; lng?: number | null; is_default?: boolean };
type Saved = { id: string; name: string; quantity: number; grade?: string };
type Estimate = {
  plant_id: string; plant_name: string; city?: string | null; district?: string | null;
  verified?: boolean; grade: string; rate_per_m3: number; gst_rate: number;
  distance_km?: number | null; service_area_km?: number | null; within_service_area?: boolean | null;
  base_amount: number; transport_amount?: number | null; pumping_amount?: number | null;
  gst_amount: number; estimated_total: number; transport_included: boolean;
};
type CompareResponse = { estimates: Estimate[]; count: number; disclaimer?: string };

const money = (value?: number | null) =>
  value == null ? "Not available" : `₹${Math.round(value).toLocaleString("en-IN")}`;

export default function ComparePlants() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string; grade?: string; quantity?: string }>();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { data: siteData } = useGet<{ sites: Site[] }>("/master/customer/sites");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [grade, setGrade] = useState(params.grade && GRADES.includes(params.grade) ? params.grade : "M25");
  const [quantity, setQuantity] = useState(params.quantity || "6");
  const [siteId, setSiteId] = useState<string | null>(params.siteId || null);
  const [pump, setPump] = useState(false);
  const [results, setResults] = useState<Estimate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => setSaved(raw ? JSON.parse(raw) : []))
      .catch(() => setSaved([]));
  }, []);

  useEffect(() => {
    const sites = siteData?.sites || [];
    if (!siteId && sites.length) setSiteId((sites.find((v) => v.is_default) || sites[0]).id);
  }, [siteData, siteId]);

  const site = (siteData?.sites || []).find((v) => v.id === siteId);
  const compared = useMemo(() => results.filter((v) => selected.includes(v.plant_id)), [results, selected]);

  const runComparison = async () => {
    if (!token) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return toast("Enter a valid quantity", "error");
    setLoading(true);
    setError(null);
    setSelected([]);
    try {
      const params = new URLSearchParams({
        grade,
        quantity: String(qty),
        pump_required: String(pump),
      });
      if (site?.lat != null && site?.lng != null) {
        params.set("lat", String(site.lat));
        params.set("lng", String(site.lng));
      }
      const response = await apiGet<CompareResponse>(`/customer/compare-plants?${params.toString()}`, token);
      setResults(response.estimates || []);
      if (!response.estimates?.length) setError("No active plant has an effective rate card for this grade.");
    } catch (e: any) {
      setError(e.detail || "Could not compare plants");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const togglePlant = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((v) => v !== id);
      if (current.length >= 3) {
        toast("Compare up to 3 plants at a time", "info");
        return current;
      }
      return [...current, id];
    });
  };

  const requestQuote = async (item: Estimate) => {
    if (!token) return;
    setRequesting(item.plant_id);
    try {
      await apiPost("/customer/quotation-requests", token, {
        plant_id: item.plant_id,
        site_id: siteId,
        site_name: site?.name || "Delivery site",
        site_address: site?.address || "Address to be confirmed with customer",
        grade,
        quantity: Number(quantity),
        pump_required: pump,
        estimated_total: item.estimated_total,
      });
      toast("Official quotation request sent to the plant", "success");
    } catch (e: any) {
      toast(e.detail || "Could not request quotation", "error");
    } finally {
      setRequesting(null);
    }
  };

  const applySaved = (item: Saved) => {
    setQuantity(String(item.quantity));
    if (item.grade && GRADES.includes(item.grade)) setGrade(item.grade);
    toast(`${item.name} loaded`, "success");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.divider }]}>
        <Pressable testID="compare-back" onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText style={[styles.headerTitle, { color: colors.onSurface }]}>Estimate & Compare</AppText>
          <AppText style={[styles.headerSub, { color: colors.onSurfaceSecondary }]}>Transparent plant rates for your requirement</AppText>
        </View>
        <Ionicons name="git-compare-outline" size={25} color={colors.brand} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: spacing.md }}>
          <View style={styles.notice}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
            <AppText variant="caption" style={{ flex: 1 }}>
              Results use active plant rate cards and are sorted by estimated total, distance and name. Premium or promotion status does not change this order.
            </AppText>
          </View>
          <AppText variant="heading">Your requirement</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {GRADES.map((item) => <Chip key={item} label={item} selected={grade === item} onPress={() => setGrade(item)} />)}
          </ScrollView>
          <Input label="Quantity (m³)" value={quantity} onChangeText={(v) => setQuantity(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
          <AppText variant="label">Delivery site</AppText>
          {(siteData?.sites || []).length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {(siteData?.sites || []).map((item) => <Chip key={item.id} label={item.name} selected={siteId === item.id} onPress={() => setSiteId(item.id)} />)}
            </ScrollView>
          ) : (
            <Button label="Add a saved site" variant="outline" onPress={() => router.push("/customer/sites")} />
          )}
          {site ? <AppText variant="caption">{site.address}{site.lat == null ? " · Map pin unavailable, so transport cannot be estimated." : ""}</AppText> : null}
          <Pressable onPress={() => setPump((v) => !v)} style={[styles.toggle, { borderColor: colors.border, backgroundColor: pump ? colors.brandSoft : colors.surfaceSecondary }]}>
            <Ionicons name={pump ? "checkbox" : "square-outline"} size={22} color={pump ? colors.brand : colors.onSurfaceTertiary} />
            <View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold }}>Concrete pump required</AppText><AppText variant="caption">Adds the plant’s pumping rate when available</AppText></View>
          </Pressable>
          {saved.length ? <View style={{ gap: spacing.sm }}><AppText variant="label">Load saved calculation</AppText><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{saved.slice(0, 8).map((item) => <Chip key={item.id} label={`${item.name} · ${item.quantity}m³`} selected={false} onPress={() => applySaved(item)} />)}</ScrollView></View> : null}
          <Button label="Find Best Plant Rates" onPress={runComparison} loading={loading} icon={<Ionicons name="search" size={18} color={colors.onBrand} />} />
        </Card>

        {error ? <Card><AppText color={colors.error}>{error}</AppText></Card> : null}

        {compared.length > 1 ? (
          <Card style={{ gap: spacing.md }}>
            <View style={styles.between}><AppText variant="heading">Side-by-side comparison</AppText><Badge label={`${compared.length}/3`} color={colors.brand} /></View>
            {compared.map((item) => <View key={item.plant_id} style={[styles.compareRow, { borderColor: colors.border }]}>
              <View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold }} numberOfLines={1}>{item.plant_name}</AppText><AppText variant="caption">{money(item.rate_per_m3)}/m³ · {item.distance_km == null ? "Distance unavailable" : `${item.distance_km.toFixed(1)} km`}</AppText></View>
              <AppText style={{ fontFamily: fonts.displayBold, color: colors.brand }}>{money(item.estimated_total)}</AppText>
            </View>)}
          </Card>
        ) : null}

        {results.map((item, index) => {
          const isSelected = selected.includes(item.plant_id);
          return <Card key={item.plant_id} style={{ gap: spacing.md, borderColor: isSelected ? colors.brand : colors.border }}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}><View style={styles.titleLine}><Badge label={`#${index + 1}`} color={colors.brand} /><AppText variant="heading" numberOfLines={2}>{item.plant_name}</AppText></View><AppText variant="caption">{[item.city, item.district].filter(Boolean).join(" · ") || "Location not provided"}</AppText></View>
              <Ionicons name="shield-checkmark" size={21} color={colors.success} />
            </View>
            <View style={[styles.totalBox, { backgroundColor: colors.surfaceTertiary }]}>
              <View><AppText variant="caption">Estimated total</AppText><AppText style={[styles.total, { color: colors.brand }]}>{money(item.estimated_total)}</AppText></View>
              <View style={{ alignItems: "flex-end" }}><AppText variant="caption">{money(item.rate_per_m3)}/m³</AppText><AppText variant="caption">{item.distance_km == null ? "Distance unavailable" : `${item.distance_km.toFixed(1)} km away`}</AppText></View>
            </View>
            <View style={{ gap: 6 }}>
              <Cost label="Concrete base" value={item.base_amount} />
              <Cost label="Transport" value={item.transport_included ? item.transport_amount : null} warning={!item.transport_included} />
              {pump ? <Cost label="Pumping" value={item.pumping_amount} warning={item.pumping_amount == null} /> : null}
              <Cost label={`GST (${item.gst_rate}%)`} value={item.gst_amount} />
            </View>
            {item.within_service_area === false ? <AppText variant="caption" color={colors.warning}>Outside the plant’s stated service radius. Confirm delivery availability.</AppText> : null}
            {!item.transport_included ? <AppText variant="caption" color={colors.warning}>Transport is excluded because a usable site/plant map location or transport rate is unavailable.</AppText> : null}
            <Button label={isSelected ? "Remove from Comparison" : "Add to Comparison"} variant="outline" onPress={() => togglePlant(item.plant_id)} />
            <View style={styles.actionRow}>
              <View style={{ flex: 1 }}><Button label="Request Quote" onPress={() => requestQuote(item)} loading={requesting === item.plant_id} /></View>
              <View style={{ flex: 1 }}><Button label="New Order" variant="outline" onPress={() => router.push({ pathname: "/new-order", params: { plantId: item.plant_id, grade, quantity } } as any)} /></View>
            </View>
          </Card>;
        })}

        {results.length ? <Card style={{ gap: spacing.sm }}><AppText variant="label">Important</AppText><AppText variant="caption">This is a planning estimate, not a final quotation or payment demand. Distance is approximate straight-line distance. Final rate, road distance, minimum load, transport, pumping, taxes, delivery availability and credit terms must be confirmed by the plant.</AppText></Card> : null}
      </ScrollView>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}><AppText style={{ fontFamily: fonts.semibold, color: selected ? colors.onBrand : colors.onSurface }}>{label}</AppText></Pressable>;
}
function Cost({ label, value, warning }: { label: string; value?: number | null; warning?: boolean }) {
  const { colors } = useTheme();
  return <View style={styles.between}><AppText variant="caption">{label}</AppText><AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm, color: warning ? colors.warning : colors.onSurface }}>{warning && value == null ? "Not included" : money(value)}</AppText></View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  headerSub: { fontSize: 12 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  chip: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  toggle: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderRadius: radius.md },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  titleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  totalBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md },
  total: { fontFamily: fonts.displayBold, fontSize: 28 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  actionRow: { flexDirection: "row", gap: spacing.sm },
});
