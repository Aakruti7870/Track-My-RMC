import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { PlantData } from "@/src/components/PlantCard";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const TIME_SLOTS = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];

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
  const { token, user } = useAuth();
  const params = useLocalSearchParams<{ assistant?: string; plantId?: string; quantity?: string; grade?: string; quotationId?: string; siteId?: string; siteName?: string; siteAddress?: string; deliveryDate?: string; deliveryTime?: string }>();
  const { data: plantsData } = useGet<{ plants: PlantData[] }>("/customer/plants");

  const days = useMemo(() => nextDays(7), []);
  const quotationLocked = Boolean(params.quotationId);
  const [plantId, setPlantId] = useState<string | null>(params.plantId || null);
  const [grade, setGrade] = useState<string | null>(params.grade || null);
  const [quantity, setQuantity] = useState(params.quantity || "6");
  const [date, setDate] = useState(params.deliveryDate || days[1].value);
  const [time, setTime] = useState<string | null>(params.deliveryTime || "10:00");
  const [siteName, setSiteName] = useState(params.siteName || "");
  const [address, setAddress] = useState(params.siteAddress || "");
  const [contact, setContact] = useState(user?.name || "");
  const [mobile, setMobile] = useState(user?.phone || "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<null | "order" | "draft">(null);
  const [error, setError] = useState<string | null>(null);
  const assistantMode = params.assistant === "1";
  const assistantIdempotencyKey = useRef(`assistant-order-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [prepared, setPrepared] = useState<{ intent_token: string; summary: Record<string, unknown> } | null>(null);

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestions, setSuggestions] = useState<{ place_id: string; text: string }[]>([]);
  const sessionToken = useMemo(() => `rmc-${Date.now()}`, []);
  const pickedRef = useRef(false);

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
      setCoords({ lat: p.lat, lng: p.lng });
      setSuggestions([]);
    } catch {
      /* Manual address remains available when place details cannot be resolved. */
    }
  };

  const plants = plantsData?.plants || [];
  const selectedPlant = plants.find((p) => p.id === plantId) || null;
  const grades = selectedPlant?.grades || [];
  const kycOk = user?.kyc_status === "VERIFIED";

  const submit = async (draft: boolean) => {
    setError(null);
    if (!plantId) return setError("Choose a plant");
    if (!grade) return setError("Select a concrete grade");
    if (!quantity || Number(quantity) <= 0) return setError("Enter a valid quantity");
    if (!siteName.trim()) return setError("Enter the site name");
    if (!address.trim()) return setError("Enter the delivery address");
    if (!draft && !kycOk) {
      toast("Complete KYC to place an order", "info");
      return router.push("/kyc");
    }
    setSubmitting(draft ? "draft" : "order");
    try {
      const order = {
        plant_id: plantId,
        quotation_id: params.quotationId || null,
        site_id: params.siteId || null,
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
        save_draft: draft,
        idempotency_key: assistantMode && !draft ? assistantIdempotencyKey.current : undefined,
      };
      if (assistantMode && !draft) {
        const intent = await apiPost<{ intent_token: string; summary: Record<string, unknown> }>("/assistant/orders/prepare", token!, { order });
        setPrepared(intent);
        return;
      }
      const res: any = await apiPost("/customer/orders", token!, order);
      toast(draft ? "Draft saved" : "Order placed!", "success");
      router.replace(`/order/${res.id}` as any);
    } catch (e: any) {
      if (e.detail === "KYC_REQUIRED") {
        toast("Complete KYC to place an order", "info");
        router.push("/kyc");
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
      toast(`Order ${res.order_number || "created"}`, "success");
      router.replace(`/order/${res.id}` as never);
    } catch (e: any) {
      setError(e.detail || "Could not confirm order");
    } finally {
      setSubmitting(null);
    }
  };

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
            onPress={() => router.push("/kyc")}
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

        {selectedPlant ? (
          <Section title="2. Concrete Grade" subtitle={quotationLocked ? "Locked by quotation" : "Choose the specified structural grade"}>
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

        <Section title="3. Quantity" subtitle="Concrete volume in cubic metres (m³)">
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

        <Section title="4. Delivery Schedule" subtitle="Choose the preferred date and arrival window">
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

        <Section title="5. Site & Contact" subtitle="Where the concrete should arrive and who will receive it">
          <View style={{ gap: spacing.md }}>
            <Input testID="neworder-site" label="Site name" value={siteName} onChangeText={setSiteName} placeholder="e.g. Skyline Towers" autoCapitalize="words" />
            <View>
              <Input testID="neworder-address" label="Delivery address" value={address} onChangeText={(t) => { setAddress(t); setCoords(null); }} placeholder="Search or type full site address" autoCapitalize="sentences" />
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
            <Input testID="neworder-contact" label="Contact person" value={contact} onChangeText={setContact} placeholder="Name at site" autoCapitalize="words" />
            <Input testID="neworder-mobile" label="Contact mobile" value={mobile} onChangeText={setMobile} placeholder="+91…" keyboardType="phone-pad" />
            <Input testID="neworder-notes" label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="e.g. Pump required" autoCapitalize="sentences" />
          </View>
        </Section>

        {error ? (
          <View accessibilityRole="alert" style={[styles.infoBanner, { backgroundColor: colors.error + "12", borderColor: colors.error + "44" }]}>
            <View style={[styles.bannerIcon, { backgroundColor: colors.error + "12" }]}>
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
            </View>
            <AppText variant="caption" color={colors.error} style={{ flex: 1 }}>{error}</AppText>
          </View>
        ) : null}

        {prepared ? <View testID="assistant-order-summary" style={[styles.submitPanel, { backgroundColor: colors.brandSoft, borderColor: colors.brand }]}>
          <AppText variant="heading">Review order summary</AppText>
          <AppText variant="caption">This order has not yet been placed. Confirm only after reviewing these details.</AppText>
          {Object.entries(prepared.summary).map(([key, value]) => value == null ? null : <AppText key={key} variant="caption">{key.replace(/_/g, " ")}: {String(value)}</AppText>)}
          <Button testID="assistant-confirm-order" label="Confirm Order" onPress={confirmAssistantOrder} loading={submitting === "order"} disabled={Boolean(submitting)} />
        </View> : <View style={[styles.submitPanel, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <View style={{ gap: 3 }}>
            <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base }}>Ready to continue?</AppText>
            <AppText variant="caption">Review the plant, mix, quantity, delivery window and site before placing the order.</AppText>
          </View>
          <Button testID="neworder-place" label={assistantMode ? "Prepare Order" : "Place Order"} onPress={() => submit(false)} loading={submitting === "order"} disabled={submitting === "draft"} icon={<Ionicons name="checkmark-circle-outline" size={18} color={colors.onBrand} />} />
          {!assistantMode ? <Button testID="neworder-draft" label="Save Draft" variant="outline" onPress={() => submit(true)} loading={submitting === "draft"} disabled={submitting === "order"} /> : null}
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
