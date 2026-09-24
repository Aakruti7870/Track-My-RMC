import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { ErrorView } from "@/src/components/StateViews";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { cashfreeCheckout } from "@/src/payments/cashfree";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type ActivePlan = { status: string; plan: string; ends_at: string; activation_mode: string } | null;
type Plant = { id: string; name: string; address?: string; city?: string; taluka?: string; district?: string; state?: string; premium: ActivePlan; promotion: ActivePlan };
type Context = {
  role: string;
  plants: Plant[];
  promotion_prices: Record<string, number>;
  premium_plans: Record<string, { months: number; price: number }>;
};
type Quote = { product: string; plan: string; price: number; discount: number; payable: number; promo_code?: string };
type PaymentStatus = "PAYMENT_PENDING" | "PAID" | "FAILED" | "USER_DROPPED";
type PaymentOrder = { order_number: string; status: PaymentStatus; product: string; plan: string; payable: number; activation_id?: string };
type CheckoutResult = { status: PaymentStatus; order_number: string; payable: number; payment_session_id?: string; cashfree_environment?: string };
type Tab = "PREMIUM" | "PROMOTION";

const money = (value: number) => `₹${value.toLocaleString("en-IN")}`;
const prettyPlan = (value?: string) => (value || "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function PlansPromotions() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<Context>("/plant-plans/context");
  const [tab, setTab] = useState<Tab>("PROMOTION");
  const [plantId, setPlantId] = useState("");
  const [plantSearch, setPlantSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [districtFilter, setDistrictFilter] = useState("ALL");
  const [talukaFilter, setTalukaFilter] = useState("ALL");
  const [duration, setDuration] = useState(30);
  const [premiumPlan, setPremiumPlan] = useState("GROWTH");
  const [promoCode, setPromoCode] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const refetchRef = useRef(refetch);

  const location = (value?: string) => value?.trim() || "Not specified";
  const stateOptions = useMemo(() => Array.from(new Set((data?.plants || []).map((p) => location(p.state)))).sort(), [data]);
  const districtOptions = useMemo(() => Array.from(new Set((data?.plants || [])
    .filter((p) => stateFilter === "ALL" || location(p.state) === stateFilter)
    .map((p) => location(p.district)))).sort(), [data, stateFilter]);
  const talukaOptions = useMemo(() => Array.from(new Set((data?.plants || [])
    .filter((p) => stateFilter === "ALL" || location(p.state) === stateFilter)
    .filter((p) => districtFilter === "ALL" || location(p.district) === districtFilter)
    .map((p) => location(p.taluka || p.city)))).sort(), [data, districtFilter, stateFilter]);
  const filteredPlants = useMemo(() => {
    const query = plantSearch.trim().toLowerCase();
    return (data?.plants || []).filter((p) => {
      if (stateFilter !== "ALL" && location(p.state) !== stateFilter) return false;
      if (districtFilter !== "ALL" && location(p.district) !== districtFilter) return false;
      if (talukaFilter !== "ALL" && location(p.taluka || p.city) !== talukaFilter) return false;
      if (!query) return true;
      return [p.name, p.address, p.city, p.taluka, p.district, p.state].some((value) => value?.toLowerCase().includes(query));
    });
  }, [data, districtFilter, plantSearch, stateFilter, talukaFilter]);
  const plant = useMemo(() => data?.plants.find((p) => p.id === plantId) || data?.plants[0], [data, plantId]);
  useEffect(() => { if (!plantId && data?.plants[0]) setPlantId(data.plants[0].id); }, [data, plantId]);
  useEffect(() => { setQuote(null); }, [tab, duration, premiumPlan, plantId]);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);
  useEffect(() => {
    cashfreeCheckout.setCallbacks({
      onVerify: (orderID: string) => { setPaymentOrder(orderID); setPaymentStatus("PAYMENT_PENDING"); toast("Payment received. Confirming securely…", "success"); },
      onError: (_error, orderID: string) => { setPaymentOrder(orderID || null); setPaymentStatus("USER_DROPPED"); toast("Payment was not completed. You can retry safely.", "error"); },
    });
    return () => cashfreeCheckout.removeCallbacks();
  }, [toast]);
  useEffect(() => {
    if (!token || !paymentOrder || paymentStatus === "PAID" || paymentStatus === "FAILED") return;
    let cancelled = false;
    let attempts = 0;
    const check = async () => {
      try {
        const order = await apiGet<PaymentOrder>(`/plant-plans/orders/${encodeURIComponent(paymentOrder)}`, token);
        if (cancelled) return;
        setPaymentStatus(order.status);
        if (order.status === "PAID") {
          toast("Payment verified. Your plan is active.", "success");
          refetchRef.current();
        } else if (order.status === "FAILED") toast("Payment failed. No plan was activated.", "error");
      } catch { /* Keep the order pending and let the next safe poll retry. */ }
      attempts += 1;
      if (!cancelled && attempts < 15) timer = setTimeout(check, 2000);
    };
    let timer = setTimeout(check, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [paymentOrder, paymentStatus, toast, token]);

  const requestQuote = async () => {
    if (!token || !plant) return;
    setBusy(true);
    try {
      const result = await apiPost<Quote>("/plant-plans/quote", token, {
        plant_id: plant.id,
        product: tab,
        duration_days: tab === "PROMOTION" ? duration : undefined,
        premium_plan: tab === "PREMIUM" ? premiumPlan : undefined,
        promo_code: promoCode.trim() || undefined,
      });
      setQuote(result);
      toast(result.discount ? `Discount applied: ${money(result.discount)}` : "Price confirmed", "success");
    } catch (e: any) { toast(e.detail || "Could not calculate plan price", "error"); }
    finally { setBusy(false); }
  };

  const activate = async () => {
    if (!token || !plant) return;
    if (!cashfreeCheckout.available) return toast("Secure payment is available in the Android app.", "error");
    setBusy(true);
    try {
      const result = await apiPost<CheckoutResult>("/plant-plans/activate", token, {
        plant_id: plant.id, product: tab,
        duration_days: tab === "PROMOTION" ? duration : undefined,
        premium_plan: tab === "PREMIUM" ? premiumPlan : undefined,
        promo_code: promoCode.trim() || undefined,
        activation_mode: "ONLINE_PAYMENT",
      });
      if (result.status === "PAYMENT_PENDING") {
        if (!result.payment_session_id) throw { detail: "Cashfree did not return a payment session" };
        setPaymentOrder(result.order_number);
        setPaymentStatus("PAYMENT_PENDING");
        cashfreeCheckout.start(result.payment_session_id, result.order_number, result.cashfree_environment === "production");
      }
      else toast(`${tab === "PROMOTION" ? "Promotion" : "Premium plan"} activated`, "success");
      refetch(); setQuote(null);
    } catch (e: any) { toast(e.detail || "Activation failed", "error"); }
    finally { setBusy(false); }
  };

  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.divider }]}>
        <Pressable testID="plans-back" onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.onSurface} /></Pressable>
        <View style={{ flex: 1 }}><AppText style={[styles.headerTitle, { color: colors.onSurface }]}>Plans &amp; Promotions</AppText><AppText style={[styles.headerSub, { color: colors.onSurfaceSecondary }]}>Grow your RMC business</AppText></View>
        <Ionicons name="diamond-outline" size={26} color={colors.brand} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}>
        {loading && !data ? <><Skeleton height={72} /><Skeleton height={220} /></> : !plant ? <Card><AppText>No plant is assigned to this account.</AppText></Card> : <>
          <PlantSearchCard
            plants={filteredPlants}
            selected={plant}
            search={plantSearch}
            onSearch={setPlantSearch}
            stateFilter={stateFilter}
            districtFilter={districtFilter}
            talukaFilter={talukaFilter}
            stateOptions={stateOptions}
            districtOptions={districtOptions}
            talukaOptions={talukaOptions}
            onState={(value) => { setStateFilter(value); setDistrictFilter("ALL"); setTalukaFilter("ALL"); }}
            onDistrict={(value) => { setDistrictFilter(value); setTalukaFilter("ALL"); }}
            onTaluka={setTalukaFilter}
            onSelect={setPlantId}
            onClear={() => { setPlantSearch(""); setStateFilter("ALL"); setDistrictFilter("ALL"); setTalukaFilter("ALL"); }}
          />

          <View style={[styles.tabs, { borderColor: colors.border }]}>
            {(["PREMIUM", "PROMOTION"] as Tab[]).map((value) => <Pressable key={value} onPress={() => setTab(value)} style={[styles.tab, tab === value && { backgroundColor: colors.brand }]}><AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: tab === value ? colors.onBrand : colors.onSurfaceSecondary }}>{prettyPlan(value)}</AppText></Pressable>)}
          </View>

          <View style={styles.statusRow}>
            <Card style={{ flex: 1, gap: 5 }}><AppText variant="label">Premium Plan</AppText><Badge label={plant.premium ? `${prettyPlan(plant.premium.plan)} · Active` : "Not active"} status={plant.premium ? "DELIVERED" : "PENDING"} />{plant.premium ? <AppText variant="caption">Ends {new Date(plant.premium.ends_at).toLocaleDateString("en-IN")}</AppText> : null}</Card>
            <Card style={{ flex: 1, gap: 5 }}><AppText variant="label">Plant Promotion</AppText><Badge label={plant.promotion ? "Promoted" : "Not active"} status={plant.promotion ? "DELIVERED" : "PENDING"} /><AppText variant="caption">Separate from Premium</AppText></Card>
          </View>

          <>
            <View style={{ gap: spacing.sm }}><AppText variant="heading">{tab === "PROMOTION" ? "Activate Plant Promotion" : "Choose Premium Plan"}</AppText><View style={styles.planRow}>
              {tab === "PROMOTION" ? [7, 15, 30].map((d) => <PlanCard key={d} selected={duration === d} label={`${d} Days`} price={data!.promotion_prices[String(d)]} onPress={() => setDuration(d)} colors={colors} />) : Object.entries(data!.premium_plans).map(([key, value]) => <PlanCard key={key} selected={premiumPlan === key} label={`${prettyPlan(key)} · ${value.months}M`} price={value.price} onPress={() => setPremiumPlan(key)} colors={colors} />)}
            </View></View>
            <Card style={{ gap: spacing.sm }}><View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}><View style={{ flex: 1 }}><AppText variant="label">Promo code (optional)</AppText><TextInput value={promoCode} onChangeText={setPromoCode} autoCapitalize="characters" placeholder="Enter Authority-issued code" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.textInput, { borderColor: colors.border, color: colors.onSurface }]} /></View><Pressable onPress={requestQuote} style={[styles.apply, { borderColor: colors.brand }]}><AppText color={colors.brand} style={{ fontFamily: fonts.semibold }}>Apply</AppText></Pressable></View>
              {quote ? <View style={[styles.quote, { borderTopColor: colors.divider }]}><Line label="Plan price" value={money(quote.price)} /><Line label="Promo discount" value={`−${money(quote.discount)}`} green /><Line label="Payable" value={money(quote.payable)} bold /></View> : null}
            </Card>
            <Button label={`Continue to Secure Payment${quote ? ` · ${money(quote.payable)}` : ""}`} onPress={activate} loading={busy} disabled={paymentStatus === "PAYMENT_PENDING"} />
            {paymentOrder ? <Card style={{ gap: spacing.sm }}><View style={styles.line}><AppText variant="label">Payment order</AppText><Badge label={prettyPlan(paymentStatus || "PAYMENT_PENDING")} status={paymentStatus === "PAID" ? "DELIVERED" : paymentStatus === "FAILED" || paymentStatus === "USER_DROPPED" ? "CANCELLED" : "PENDING"} /></View><AppText>{paymentOrder}</AppText><AppText variant="caption">{paymentStatus === "PAID" ? "Cashfree verified the payment and access is active." : paymentStatus === "FAILED" || paymentStatus === "USER_DROPPED" ? "No access was activated. You can safely retry payment." : "Waiting for Cashfree's signed webhook. Access remains locked until verification."}</AppText></Card> : null}
            <View style={styles.audit}><Ionicons name="shield-checkmark-outline" size={18} color={colors.brand} /><AppText variant="caption" style={{ flex: 1 }}>Payment orders do not grant access until payment is verified by Cashfree.</AppText></View>
          </>
        </>}
      </ScrollView>
    </View>
  );
}

function PlantSearchCard({
  plants, selected, search, onSearch, stateFilter, districtFilter, talukaFilter,
  stateOptions, districtOptions, talukaOptions, onState, onDistrict, onTaluka, onSelect, onClear,
}: {
  plants: Plant[]; selected: Plant; search: string; onSearch(value: string): void;
  stateFilter: string; districtFilter: string; talukaFilter: string;
  stateOptions: string[]; districtOptions: string[]; talukaOptions: string[];
  onState(value: string): void; onDistrict(value: string): void; onTaluka(value: string): void;
  onSelect(id: string): void; onClear(): void;
}) {
  const { colors } = useTheme();
  const [openFilter, setOpenFilter] = useState<"STATE" | "DISTRICT" | "TALUKA" | null>(null);
  const activeFilters = [stateFilter, districtFilter, talukaFilter].filter((value) => value !== "ALL").length + (search.trim() ? 1 : 0);

  const filter = (label: string, value: string, key: "STATE" | "DISTRICT" | "TALUKA", options: string[], onChange: (value: string) => void) => (
    <View style={{ flex: 1, gap: spacing.xs }}>
      <AppText variant="caption">{label}</AppText>
      <Pressable
        testID={`plant-filter-${key.toLowerCase()}`}
        onPress={() => setOpenFilter(openFilter === key ? null : key)}
        style={[styles.filterSelect, { backgroundColor: colors.surfaceTertiary, borderColor: value === "ALL" ? colors.border : colors.brand }]}
      >
        <AppText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.onSurface }}>
          {value === "ALL" ? `All ${label}s` : value}
        </AppText>
        <Ionicons name={openFilter === key ? "chevron-up" : "chevron-down"} size={15} color={colors.onSurfaceTertiary} />
      </Pressable>
      {openFilter === key ? (
        <View style={[styles.optionMenu, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Pressable onPress={() => { onChange("ALL"); setOpenFilter(null); }} style={styles.option}>
            <AppText style={{ fontFamily: value === "ALL" ? fonts.semibold : fonts.regular }}>All {label}s</AppText>
          </Pressable>
          {options.map((option) => (
            <Pressable key={option} onPress={() => { onChange(option); setOpenFilter(null); }} style={styles.option}>
              <AppText numberOfLines={1} style={{ fontFamily: value === option ? fonts.semibold : fonts.regular, color: value === option ? colors.brand : colors.onSurface }}>{option}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.line}>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">Find & Select Plant</AppText>
          <AppText variant="caption">Filter by location or search plant name and address</AppText>
        </View>
        {activeFilters ? <Pressable onPress={onClear}><AppText style={{ color: colors.brand, fontFamily: fonts.semibold }}>Clear</AppText></Pressable> : null}
      </View>

      <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.surfaceTertiary }]}>
        <Ionicons name="search-outline" size={19} color={colors.onSurfaceTertiary} />
        <TextInput
          testID="plant-search-input"
          value={search}
          onChangeText={onSearch}
          placeholder="Search plant name, city or address"
          placeholderTextColor={colors.onSurfaceTertiary}
          style={{ flex: 1, color: colors.onSurface, fontFamily: fonts.medium, fontSize: fontSize.base }}
        />
        {search ? <Pressable onPress={() => onSearch("")}><Ionicons name="close-circle" size={19} color={colors.onSurfaceTertiary} /></Pressable> : null}
      </View>

      <View style={styles.locationFilters}>
        {filter("State", stateFilter, "STATE", stateOptions, onState)}
        {filter("District", districtFilter, "DISTRICT", districtOptions, onDistrict)}
        {filter("Taluka", talukaFilter, "TALUKA", talukaOptions, onTaluka)}
      </View>

      <View style={styles.line}>
        <AppText variant="label">{plants.length} plant{plants.length === 1 ? "" : "s"} found</AppText>
        <AppText variant="caption">Selected: {selected.name}</AppText>
      </View>

      <View style={{ gap: spacing.sm }}>
        {plants.slice(0, 8).map((p) => {
          const isSelected = p.id === selected.id;
          const place = [p.taluka || p.city, p.district, p.state].filter(Boolean).join(", ") || "Location not specified";
          return (
            <Pressable
              key={p.id}
              testID={`select-plant-${p.id}`}
              onPress={() => onSelect(p.id)}
              style={[styles.plantResult, {
                backgroundColor: isSelected ? colors.brandSoft : colors.surfaceSecondary,
                borderColor: isSelected ? colors.brand : colors.border,
              }]}
            >
              <View style={[styles.plantIcon, { backgroundColor: isSelected ? colors.brand : colors.surfaceTertiary }]}>
                <Ionicons name="business" size={18} color={isSelected ? colors.onBrand : colors.onSurfaceSecondary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{p.name}</AppText>
                <AppText variant="caption" numberOfLines={1}>{place}</AppText>
              </View>
              <Ionicons name={isSelected ? "checkmark-circle" : "chevron-forward"} size={20} color={isSelected ? colors.brand : colors.onSurfaceTertiary} />
            </Pressable>
          );
        })}
        {!plants.length ? (
          <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg }}>
            <Ionicons name="search-outline" size={28} color={colors.onSurfaceTertiary} />
            <AppText variant="heading">No plants found</AppText>
            <AppText variant="caption" center>Clear filters or search with a different plant name.</AppText>
          </View>
        ) : plants.length > 8 ? <AppText variant="caption" center>Refine the filters to narrow {plants.length} matching plants.</AppText> : null}
      </View>
    </Card>
  );
}

function PlanCard({ selected, label, price, onPress, colors }: any) { return <Pressable onPress={onPress} style={[styles.plan, { borderColor: selected ? colors.brand : colors.border, backgroundColor: selected ? colors.brandSoft : colors.surfaceSecondary }]}>{selected ? <Ionicons name="checkmark-circle" size={17} color={colors.brand} style={styles.check} /> : null}<AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.onSurface }}>{label}</AppText><AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: selected ? colors.brand : colors.onSurface }}>{money(price)}</AppText></Pressable>; }
function Line({ label, value, bold, green }: any) { const { colors } = useTheme(); return <View style={styles.line}><AppText style={{ fontFamily: bold ? fonts.bold : fonts.regular, color: colors.onSurface }}>{label}</AppText><AppText style={{ fontFamily: bold ? fonts.bold : fonts.semibold, color: green ? colors.success : colors.onSurface }}>{value}</AppText></View>; }

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth }, headerTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl }, headerSub: { fontFamily: fonts.regular, fontSize: 12 },
  searchBox: { height: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md }, locationFilters: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, zIndex: 5 }, filterSelect: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.sm }, optionMenu: { position: "absolute", top: 66, left: 0, right: 0, zIndex: 20, maxHeight: 220, borderWidth: 1, borderRadius: radius.md, padding: spacing.xs }, option: { minHeight: 38, justifyContent: "center", paddingHorizontal: spacing.sm }, plantResult: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm }, plantIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center" }, tabs: { flexDirection: "row", padding: 4, borderWidth: 1, borderRadius: radius.md }, tab: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statusRow: { flexDirection: "row", gap: spacing.sm }, planRow: { flexDirection: "row", gap: spacing.sm }, plan: { flex: 1, minHeight: 88, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: 5, position: "relative" }, check: { position: "absolute", right: 6, top: 6 }, textInput: { height: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, marginTop: 6, fontFamily: fonts.medium }, apply: { height: 44, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, justifyContent: "center" }, quote: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, gap: spacing.sm }, line: { flexDirection: "row", justifyContent: "space-between" }, toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, audit: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
});
