import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { PlantData } from "@/src/components/PlantCard";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const TIME_SLOTS = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];
type DraftForm = {
  plant_id: string | null; grade: string | null; quantity: string; date: string; time: string | null;
  site_name: string; address: string; contact: string; mobile: string; notes: string;
  payment_mode: string | null; quotation_id: string | null; site_id: string | null;
  lat: number | null; lng: number | null; pump_required: boolean;
};
type SavedDraft = { id: string; form: DraftForm; updated_at: string; provisional_id?: string | null; provisional_order_id?: string | null; provisional_status?: string | null; plant_response?: string | null };
const PAYMENT_MODES = [
  { value: "FULL_ADVANCE", label: "100% Advance", desc: "Pay in full after plant acceptance" },
  { value: "PARTIAL_ADVANCE", label: "Partial Advance", desc: "Plant confirms the exact deposit and balance terms" },
  { value: "ON_DELIVERY", label: "Pay on Delivery", desc: "Available only when the plant approves delivery payment" },
  { value: "APPROVED_CREDIT", label: "Credit / Pay Later", desc: "Subject to the plant's credit approval" },
] as const;

// Production cannot offer advance modes until supplier settlement is approved.
// The Cashfree route is sandbox-only; do not let customers accept unpayable terms.
const SHOW_SANDBOX_PREPAID = process.env.EXPO_PUBLIC_RMC_PREPAID_SANDBOX_UI === "true";
const SELECTABLE_PAYMENT_MODES = SHOW_SANDBOX_PREPAID
  ? PAYMENT_MODES
  : PAYMENT_MODES.filter((mode) => mode.value === "ON_DELIVERY" || mode.value === "APPROVED_CREDIT");

function nextDays(n: number) {
  const out: { value: string; label: string; sub: string }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const value = d.toISOString().slice(0, 10);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" });
    const sub = d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
    out.push({ value, label, sub });
  }
  return out;
}

export default function NewOrder() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { hydrating, token, user } = useAuth();
  const formOwner = useRef<string | null>(user?.id || null);
  if (!formOwner.current && user?.id) formOwner.current = user.id;
  const params = useLocalSearchParams<{ assistant?: string; draftId?: string; plantId?: string; quantity?: string; grade?: string; quotationId?: string; siteId?: string; siteName?: string; siteAddress?: string; deliveryDate?: string; deliveryTime?: string }>();
  const { data: plantsData } = useGet<{ plants: PlantData[] }>("/customer/plants");
  const { data: savedDraft, loading: loadingDraft, error: draftError } = useGet<SavedDraft>(
    params.draftId ? `/customer/order-drafts/${encodeURIComponent(params.draftId)}` : null,
  );

  const days = useMemo(() => nextDays(7), []);
  const [draftId, setDraftId] = useState<string | null>(params.draftId || null);
  const [provisionalId, setProvisionalId] = useState<string | null>(null);
  const [provisionalStatus, setProvisionalStatus] = useState<string | null>(null);
  const [provisionalOrderId, setProvisionalOrderId] = useState<string | null>(null);
  const [plantResponse, setPlantResponse] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(!params.draftId);
  const [quotationId, setQuotationId] = useState<string | null>(params.quotationId || null);
  const [siteId, setSiteId] = useState<string | null>(params.siteId || null);
  const quotationLocked = Boolean(quotationId);
  const [plantId, setPlantId] = useState<string | null>(params.plantId || null);
  const [grade, setGrade] = useState<string | null>(params.grade || null);
  const [paymentMode, setPaymentMode] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(params.quantity || "6");
  const [date, setDate] = useState(params.deliveryDate || days[1].value);
  const [time, setTime] = useState<string | null>(params.deliveryTime || "10:00");
  const [siteName, setSiteName] = useState(params.siteName || "");
  const [address, setAddress] = useState(params.siteAddress || "");
  const [contact, setContact] = useState(user?.verified_name || user?.name || "");
  const [mobile, setMobile] = useState(user?.phone || "");
  const [notes, setNotes] = useState("");
  const [pumpRequired, setPumpRequired] = useState(false);
  const [submitting, setSubmitting] = useState<null | "order" | "draft" | "kyc" | "provisional">(null);
  const [error, setError] = useState<string | null>(null);
  const assistantMode = params.assistant === "1";
  const orderRequest = useRef<{ signature: string; key: string } | null>(null);
  const [prepared, setPrepared] = useState<{ intent_token: string; summary: Record<string, unknown> } | null>(null);

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestions, setSuggestions] = useState<{ place_id: string; text: string }[]>([]);
  const sessionToken = useMemo(() => `rmc-${Date.now()}`, []);
  const pickedRef = useRef(false);
  const restoredDraft = useRef<string | null>(null);

  useEffect(() => {
    if (hydrating) return;
    if (!token || !user) router.replace("/login");
    else if (user.role !== "customer") router.replace("/role-home");
    else if (formOwner.current !== user.id) router.replace("/customer");
  }, [hydrating, token, user, router]);

  useEffect(() => {
    if (!savedDraft || restoredDraft.current === savedDraft.id) return;
    const f = savedDraft.form;
    restoredDraft.current = savedDraft.id;
    setDraftId(savedDraft.id); setPlantId(f.plant_id); setGrade(f.grade); setQuantity(f.quantity);
    setDate(f.date); setTime(f.time); setSiteName(f.site_name); setAddress(f.address);
    setContact(f.contact); setMobile(f.mobile); setNotes(f.notes); setPaymentMode(f.payment_mode);
    setQuotationId(f.quotation_id); setSiteId(f.site_id); setPumpRequired(f.pump_required);
    setProvisionalId(savedDraft.provisional_id || null); setProvisionalStatus(savedDraft.provisional_status || null);
    setProvisionalOrderId(savedDraft.provisional_order_id || null);
    setPlantResponse(savedDraft.plant_response || null);
    setCoords(f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : null);
    setDraftReady(true);
  }, [savedDraft]);

  // A reviewed summary is tied to the exact form used to prepare it.
  useEffect(() => {
    setPrepared(null);
  }, [plantId, grade, quantity, date, time, siteName, address, contact, mobile, notes,
    paymentMode, quotationId, siteId, pumpRequired, coords?.lat, coords?.lng]);

  useEffect(() => {
    if (pickedRef.current) { pickedRef.current = false; return; }
    const q = address.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<{ configured: boolean; suggestions: { place_id: string; text: string }[] }>(
          `/maps/autocomplete?input=${encodeURIComponent(q)}&session_token=${sessionToken}`, token!);
        setSuggestions(res.configured ? res.suggestions : []);
      } catch {
        setSuggestions([]);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [address, token, sessionToken]);

  const pickPlace = async (place_id: string) => {
    try {
      const p = await apiGet<{ address: string; lat: number; lng: number }>(`/maps/place/${place_id}?session_token=${sessionToken}`, token!);
      pickedRef.current = true;
      setAddress(p.address);
      setSiteId(null);
      setCoords({ lat: p.lat, lng: p.lng });
      setSuggestions([]);
    } catch {
      /* Manual address remains available when place details cannot be resolved. */
    }
  };

  const plants = plantsData?.plants || [];
  const selectedPlant = plants.find((p) => p.id === plantId) || null;
  const grades = selectedPlant?.grades || [];
  const kycOk = user?.kyc_status?.toUpperCase() === "VERIFIED";
  const verifiedCustomerName = kycOk ? user?.verified_name?.trim() : null;

  const saveDraft = async (copy = false) => {
    if (!token || !user || user.role !== "customer") throw { detail: "Sign in as a customer to save this draft" };
    if (params.draftId && (loadingDraft || draftError || !savedDraft || !draftReady)) throw { detail: "The saved draft could not be loaded" };
    const form: DraftForm = {
      plant_id: plantId, grade, quantity, date, time, site_name: siteName, address, contact, mobile, notes,
      payment_mode: paymentMode, quotation_id: quotationId, site_id: siteId,
      lat: coords?.lat ?? null, lng: coords?.lng ?? null, pump_required: pumpRequired,
    };
    const result = await apiPost<{ id: string }>("/customer/order-drafts", token, { id: copy ? null : draftId, form });
    if (!copy) setDraftId(result.id);
    return result.id;
  };

  const copyExpiredRequest = async () => {
    if (submitting) return;
    setSubmitting("draft"); setError(null);
    try {
      const id = await saveDraft(true);
      router.push({ pathname: "/new-order", params: { draftId: id } });
    } catch (e: any) { setError(e.detail || "Could not copy this request"); }
    finally { setSubmitting(null); }
  };

  const startKycFromOrder = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting("kyc");
    try {
      const id = await saveDraft();
      router.push({ pathname: "/kyc", params: { draftId: id } });
    } catch (e: any) {
      setError(e.detail || "Could not save your draft before verification");
    } finally { setSubmitting(null); }
  };

  const sendProvisional = async () => {
    if (submitting || !token) return;
    setError(null); setSubmitting("provisional");
    try {
      const id = await saveDraft();
      await apiPost(`/customer/order-drafts/${id}/provisional`, token, {});
      toast("Provisional request sent. It is not an accepted order.", "success");
      router.replace("/customer/orders");
    } catch (e: any) { setError(e.detail || "Could not send the provisional request"); }
    finally { setSubmitting(null); }
  };

  const submit = async (draft: boolean) => {
    if (submitting) return;
    setError(null);
    if (draft) {
      setSubmitting("draft");
      try {
        await saveDraft();
        toast("Draft saved", "success");
        router.replace("/customer/orders");
      } catch (e: any) { setError(e.detail || "Could not save draft"); }
      finally { setSubmitting(null); }
      return;
    }
    if (!kycOk) return startKycFromOrder();
    if (provisionalId && provisionalStatus !== "PENDING_KYC") return setError("This provisional request is no longer available. Start a new order.");
    if (!plantId) return setError("Choose a plant");
    if (!paymentMode) return setError("Choose a preferred payment mode");
    if (!grade) return setError("Select a concrete grade");
    if (!quantity || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return setError("Enter a valid quantity");
    if (!siteName.trim()) return setError("Enter the site name");
    if (!address.trim()) return setError("Enter the delivery address");
    setSubmitting("order");
    try {
      const savedId = await saveDraft();
      const order = {
        plant_id: plantId,
        quotation_id: quotationId,
        ...(provisionalId ? { provisional_request_id: provisionalId } : {}),
        site_id: siteId,
        grade,
        quantity: Number(quantity),
        site_name: siteName.trim(),
        site_address: address.trim(),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        delivery_date: date,
        delivery_time: time,
        contact_person: contact.trim() || null,
        contact_mobile: mobile.trim() || null,
        notes: notes.trim() || null,
        pump_required: pumpRequired,
        save_draft: false,
        preferred_payment_mode: paymentMode,
      };
      const signature = JSON.stringify(order);
      if (orderRequest.current?.signature !== signature) {
        orderRequest.current = { signature, key: `customer-order-draft-${savedId}` };
      }
      const request = { ...order, idempotency_key: orderRequest.current!.key };
      if (assistantMode || provisionalId) {
        const intent = await apiPost<{ intent_token: string; summary: Record<string, unknown> }>("/assistant/orders/prepare", token!, { order: request });
        setPrepared(intent);
        return;
      }
      const res: any = await apiPost("/customer/orders", token!, request);
      await apiDelete(`/customer/order-drafts/${savedId}`, token!).catch(() => undefined);
      toast("Order request submitted. No payment is required yet.", "success");
      router.replace(`/order/${res.id}` as any);
    } catch (e: any) {
      if (e.detail === "KYC_REQUIRED") {
        setError("Your KYC status has changed. Save the draft and complete verification before submitting.");
      } else {
        setError(e.detail || "Could not place order");
      }
    } finally {
      setSubmitting(null);
    }
  };

  const confirmAssistantOrder = async () => {
    if (!prepared || submitting) return;
    setSubmitting("order");
    setError(null);
    try {
      const res = await apiPost<{ id: string; order_number?: string }>("/assistant/orders/confirm", token!, {
        intent_token: prepared.intent_token,
        confirmed: true,
      });
      if (draftId) await apiDelete(`/customer/order-drafts/${draftId}`, token!).catch(() => undefined);
      toast(`Order ${res.order_number || "created"}`, "success");
      router.replace(`/order/${res.id}` as never);
    } catch (e: any) {
      setPrepared(null);
      setError(e.detail || "Could not confirm order");
    } finally {
      setSubmitting(null);
    }
  };

  if (hydrating || !token || !user || user.role !== "customer" || formOwner.current !== user.id) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable
          testID="neworder-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceTertiary : colors.surfaceSecondary }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="title">{assistantMode ? "Place Order with Agent" : "New Order"}</AppText>
          <AppText variant="caption">Plant → mix → schedule → site</AppText>
        </View>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {quotationLocked ? (
          <View style={[styles.infoBanner, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "55" }]}>
            <View style={[styles.bannerIcon, { backgroundColor: colors.brand + "16" }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.brand} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm }}>Quotation-linked order</AppText>
              <AppText variant="caption">Plant, grade and quantity are locked to the accepted quotation. Schedule and site details remain editable.</AppText>
            </View>
          </View>
        ) : null}

        {!kycOk ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Complete KYC"
            accessibilityHint="Opens identity verification"
            onPress={startKycFromOrder}
            style={({ pressed }) => [styles.infoBanner, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "44", opacity: pressed ? 0.86 : 1 }]}
          >
            <View style={[styles.bannerIcon, { backgroundColor: colors.warning + "16" }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm }}>KYC required for live ordering</AppText>
              <AppText variant="caption">You can complete this order as a draft now and verify before placing it.</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        ) : null}

        {provisionalId ? <Card style={{ gap: spacing.sm, borderColor: colors.warning + "66" }}>
          <AppText variant="heading">{provisionalStatus === "PENDING_KYC" ? (kycOk ? "Awaiting your confirmation" : "Provisional request · KYC pending") : `Request ${provisionalStatus || "unavailable"}`}</AppText>
          <AppText variant="caption">The plant has the original nonbinding request. Any edits below will be reviewed again when you prepare the order.</AppText>
          {plantResponse ? <AppText variant="body">Plant response: {plantResponse}</AppText> : null}
          {provisionalStatus === "CONVERTED" && provisionalOrderId ? <Button label="Open Submitted Order" onPress={() => router.replace({ pathname: "/order/[id]", params: { id: provisionalOrderId } })} /> : null}
          {provisionalStatus === "EXPIRED" ? <Button label="Copy to a New Draft" variant="outline" onPress={copyExpiredRequest} loading={submitting === "draft"} disabled={Boolean(submitting)} /> : null}
        </Card> : null}

        <Section title="1. Choose Plant" subtitle={quotationLocked ? "Locked by quotation" : "Select the verified plant supplying this order"}>
          <View style={{ gap: spacing.sm }}>
            {plants.map((p) => {
              const sel = p.id === plantId;
              const lockedOut = quotationLocked && !sel;
              return (
                <Pressable
                  key={p.id}
                  testID={`neworder-plant-${p.id}`}
                  disabled={quotationLocked}
                  accessibilityRole="radio"
                  accessibilityLabel={`${p.name}, ${p.city}${p.verified ? ", verified" : ""}`}
                  accessibilityState={{ selected: sel, disabled: quotationLocked }}
                  onPress={() => {
                    setPlantId(p.id);
                    setGrade(params.grade && p.grades?.includes(params.grade) ? params.grade : null);
                  }}
                  style={({ pressed }) => [
                    styles.plantRow,
                    {
                      borderColor: sel ? colors.brand : colors.border,
                      backgroundColor: sel ? colors.brandSoft : colors.surfaceSecondary,
                      opacity: lockedOut ? 0.5 : pressed ? 0.88 : 1,
                    },
                  ]}
                >
                  <Ionicons name={sel ? "radio-button-on" : "radio-button-off"} size={20} color={sel ? colors.brand : colors.onSurfaceTertiary} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{p.name}</AppText>
                    <AppText variant="caption">{p.city}</AppText>
                  </View>
                  {p.verified ? <Ionicons name="shield-checkmark" size={17} color={colors.verified} /> : null}
                  {quotationLocked && sel ? <Ionicons name="lock-closed" size={15} color={colors.onSurfaceTertiary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="2. Preferred Payment Mode" subtitle="Choose how you would prefer to pay after plant acceptance">
          <View style={{ gap: spacing.sm }}>
            {SELECTABLE_PAYMENT_MODES.map((mode) => {
              const selected = paymentMode === mode.value;
              return (
                <Pressable
                  key={mode.value}
                  testID={`neworder-payment-${mode.value}`}
                  accessibilityRole="radio"
                  accessibilityLabel={mode.label}
                  accessibilityState={{ selected }}
                  onPress={() => setPaymentMode(mode.value)}
                  style={({ pressed }) => [
                    styles.plantRow,
                    { borderColor: selected ? colors.brand : colors.border,
                      backgroundColor: selected ? colors.brandSoft : colors.surfaceSecondary,
                      opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.brand : colors.onSurfaceTertiary} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText style={{ fontFamily: fonts.semibold }}>{mode.label}</AppText>
                    <AppText variant="caption">{mode.desc}</AppText>
                  </View>
                </Pressable>
              );
            })}
            <View style={[styles.infoBanner, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "55" }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.brand} />
              <AppText variant="caption" style={{ flex: 1 }}>
                No payment is required when submitting this order request. Your selection is a preference, subject to the plant's acceptance and final terms. Review and accept the confirmed amount before paying. {SHOW_SANDBOX_PREPAID
                  ? "Sandbox prepaid testing is available only for approved test plants; no real payment is collected. Never pay using an unofficial link."
                  : "Online advance payments are not yet activated. Use pay-on-delivery or plant-approved credit only. Never pay using an unofficial link."}
              </AppText>
            </View>
          </View>
        </Section>

        {selectedPlant ? (
          <Section title="3. Concrete Grade" subtitle={quotationLocked ? "Locked by quotation" : "Choose the specified structural grade"}>
            <View style={styles.chips}>
              {grades.map((g) => {
                const sel = g === grade;
                return (
                  <Pressable
                    key={g}
                    testID={`grade-${g}`}
                    disabled={quotationLocked}
                    accessibilityRole="radio"
                    accessibilityLabel={`${g} concrete grade`}
                    accessibilityState={{ selected: sel, disabled: quotationLocked }}
                    onPress={() => setGrade(g)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: sel ? colors.brand : colors.surfaceSecondary,
                        borderColor: sel ? colors.brand : colors.border,
                        opacity: !sel && quotationLocked ? 0.48 : pressed ? 0.86 : 1,
                      },
                    ]}
                  >
                    <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, color: sel ? colors.onBrand : colors.onSurfaceSecondary }}>{g}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        ) : null}

        <Section title="4. Quantity" subtitle="Concrete volume in cubic metres (m³)">
          <View style={styles.stepper}>
            <Stepper icon="remove" label="Decrease quantity" disabled={quotationLocked} onPress={() => setQuantity((q) => String(Math.max(1, Number(q) - 1)))} colors={colors} />
            <View style={{ flex: 1 }}>
              <Input
                testID="neworder-quantity"
                value={quantity}
                onChangeText={(t) => setQuantity(t.replace(/[^0-9.]/g, ""))}
                keyboardType="numeric"
                editable={!quotationLocked}
                center
              />
            </View>
            <Stepper icon="add" label="Increase quantity" disabled={quotationLocked} onPress={() => setQuantity((q) => String(Number(q || "0") + 1))} colors={colors} />
          </View>
        </Section>

        <Section title="5. Delivery Schedule" subtitle="Choose the preferred date and arrival window">
          <View style={styles.scheduleBlock}>
            <AppText variant="label">Date</AppText>
            <View style={styles.chips}>
              {days.map((d) => {
                const sel = d.value === date;
                return (
                  <Pressable
                    key={d.value}
                    testID={`date-${d.value}`}
                    accessibilityRole="radio"
                    accessibilityLabel={`${d.label}, ${d.sub}`}
                    accessibilityState={{ selected: sel }}
                    onPress={() => setDate(d.value)}
                    style={({ pressed }) => [styles.dateChip, { backgroundColor: sel ? colors.brand : colors.surfaceSecondary, borderColor: sel ? colors.brand : colors.border, opacity: pressed ? 0.86 : 1 }]}
                  >
                    <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: sel ? colors.onBrand : colors.onSurface }}>{d.label}</AppText>
                    <AppText style={{ fontFamily: fonts.regular, fontSize: 10, color: sel ? colors.onBrand : colors.onSurfaceTertiary }}>{d.sub}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.scheduleBlock}>
            <AppText variant="label">Preferred time</AppText>
            <View style={styles.chips}>
              {TIME_SLOTS.map((t) => {
                const sel = t === time;
                return (
                  <Pressable
                    key={t}
                    testID={`time-${t}`}
                    accessibilityRole="radio"
                    accessibilityLabel={`${t} delivery time`}
                    accessibilityState={{ selected: sel }}
                    onPress={() => setTime(t)}
                    style={({ pressed }) => [styles.chip, { backgroundColor: sel ? colors.brand : colors.surfaceSecondary, borderColor: sel ? colors.brand : colors.border, opacity: pressed ? 0.86 : 1 }]}
                  >
                    <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, color: sel ? colors.onBrand : colors.onSurfaceSecondary }}>{t}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Section>

        <Section title="Pump requirement" subtitle="Tell the plant whether a pump is required">
          <View style={styles.chips}>
            {[false, true].map((value) => <Pressable key={String(value)} accessibilityRole="radio"
              accessibilityState={{ selected: pumpRequired === value }} onPress={() => setPumpRequired(value)}
              style={[styles.chip, { backgroundColor: pumpRequired === value ? colors.brand : colors.surfaceSecondary, borderColor: colors.border }]}>
              <AppText style={{ color: pumpRequired === value ? colors.onBrand : colors.onSurface }}>Pump {value ? "required" : "not required"}</AppText>
            </Pressable>)}
          </View>
        </Section>

        <Section title="6. Site & Contact" subtitle="Where the concrete should arrive and who will receive it">
          <View style={{ gap: spacing.md }}>
            {verifiedCustomerName ? (
              <Card testID="neworder-verified-customer" style={{ gap: 4, borderColor: colors.success + "55" }}>
                <AppText variant="caption">DigiLocker-verified customer</AppText>
                <AppText variant="heading">{verifiedCustomerName}</AppText>
                <AppText variant="caption">The verified account identity is read-only. The delivery-site contact below can be different.</AppText>
              </Card>
            ) : null}
            <Input testID="neworder-site" label="Site name" value={siteName} onChangeText={(v) => { setSiteName(v); setSiteId(null); }} placeholder="e.g. Skyline Towers" autoCapitalize="words" />
            <View>
              <Input testID="neworder-address" label="Delivery address" value={address} onChangeText={(t) => { setAddress(t); setCoords(null); setSiteId(null); }} placeholder="Search or type full site address" autoCapitalize="sentences" />
              {suggestions.length > 0 ? (
                <View style={[styles.suggestBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  {suggestions.map((s) => (
                    <Pressable
                      key={s.place_id}
                      testID={`suggest-${s.place_id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Use address ${s.text}`}
                      onPress={() => pickPlace(s.place_id)}
                      style={({ pressed }) => [styles.suggestRow, { borderBottomColor: colors.divider, backgroundColor: pressed ? colors.surfaceTertiary : "transparent" }]}
                    >
                      <Ionicons name="location-outline" size={17} color={colors.brand} />
                      <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.onSurface }} numberOfLines={2}>{s.text}</AppText>
                      <Ionicons name="arrow-forward" size={15} color={colors.onSurfaceTertiary} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {coords ? (
                <View style={[styles.pinRow, { backgroundColor: colors.brandSoft }]}>
                  <Ionicons name="pin" size={14} color={colors.brand} />
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.brand }}>Location pinned</AppText>
                </View>
              ) : null}
            </View>
            <Input testID="neworder-contact" label="Contact person" value={contact} onChangeText={(v) => { setContact(v); setSiteId(null); }} placeholder="Name at site" autoCapitalize="words" />
            <Input testID="neworder-mobile" label="Contact mobile" value={mobile} onChangeText={(v) => { setMobile(v); setSiteId(null); }} placeholder="+91…" keyboardType="phone-pad" />
            <Input testID="neworder-notes" label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="e.g. Pump required" autoCapitalize="sentences" />
          </View>
        </Section>

        {error || draftError ? (
          <View accessibilityRole="alert" style={[styles.infoBanner, { backgroundColor: colors.error + "12", borderColor: colors.error + "44" }]}>
            <View style={[styles.bannerIcon, { backgroundColor: colors.error + "12" }]}>
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
            </View>
            <AppText variant="caption" color={colors.error} style={{ flex: 1 }}>{error || draftError}</AppText>
          </View>
        ) : null}

        {prepared ? <View testID="assistant-order-summary" style={[styles.submitPanel, { backgroundColor: colors.brandSoft, borderColor: colors.brand }]}>
          <AppText variant="heading">Review order summary</AppText>
          <AppText variant="caption">This order has not yet been placed. Confirm only after reviewing the current price and details.</AppText>
          {Object.entries(prepared.summary).map(([key, value]) => {
            if (value == null) return null;
            if (key === "pricing" && typeof value === "object") return Object.entries(value as Record<string, unknown>)
              .filter(([field]) => !["rate_card_id", "quotation_id", "source"].includes(field))
              .map(([field, amount]) => <AppText key={field} variant="caption">{field.replace(/_/g, " ")}: {String(amount)}</AppText>);
            return <AppText key={key} variant="caption">{key.replace(/_/g, " ")}: {String(value)}</AppText>;
          })}
          <Button testID="assistant-confirm-order" label="Confirm Order" onPress={confirmAssistantOrder} loading={submitting === "order"} disabled={Boolean(submitting)} />
        </View> : <View style={[styles.submitPanel, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <View style={{ gap: 3 }}>
            <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base }}>Ready to continue?</AppText>
            <AppText variant="caption">Submitting sends an order request for plant review. No payment will be collected now.</AppText>
          </View>
          <Button testID="neworder-place" label={!kycOk ? "Complete KYC Now" : provisionalId ? "Review Current Order" : assistantMode ? "Prepare Order" : "Submit Order Request"} onPress={() => submit(false)} loading={submitting === "order" || submitting === "kyc"} disabled={Boolean(submitting) || loadingDraft || Boolean(draftError) || !draftReady || Boolean(provisionalId && provisionalStatus !== "PENDING_KYC")} icon={<Ionicons name="checkmark-circle-outline" size={18} color={colors.onBrand} />} />
          {!kycOk && !provisionalId && !assistantMode ? <Button testID="neworder-provisional" label="Send Request & Complete KYC Later" variant="outline" onPress={sendProvisional} loading={submitting === "provisional"} disabled={Boolean(submitting) || loadingDraft || Boolean(draftError) || !draftReady} /> : null}
          {!assistantMode ? <Button testID="neworder-draft" label="Save Draft" variant="outline" onPress={() => submit(true)} loading={submitting === "draft"} disabled={Boolean(submitting) || loadingDraft || Boolean(draftError) || !draftReady} /> : null}
        </View>}
      </KeyboardAwareScrollView>
    </View>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ gap: 2 }}>
        <AppText variant="heading">{title}</AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </View>
      {children}
    </View>
  );
}

function Stepper({ icon, label, onPress, colors, disabled = false }: any) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.stepBtn, { backgroundColor: colors.surfaceTertiary, opacity: disabled ? 0.45 : pressed ? 0.78 : 1 }]}
    >
      <Ionicons name={disabled ? "lock-closed" : icon} size={20} color={disabled ? colors.onSurfaceTertiary : colors.onSurface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  infoBanner: { minHeight: 64, flexDirection: "row", gap: spacing.sm, alignItems: "center", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  bannerIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 42, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dateChip: { width: 76, minHeight: 56, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  plantRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepBtn: { width: 56, height: 56, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  scheduleBlock: { gap: spacing.sm },
  suggestBox: { marginTop: 6, borderWidth: 1, borderRadius: radius.lg, overflow: "hidden" },
  suggestRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  pinRow: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill },
  submitPanel: { gap: spacing.md, borderWidth: 1, borderRadius: radius.xl, padding: spacing.lg },
});
