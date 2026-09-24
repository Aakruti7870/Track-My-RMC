import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const GRADES = ["M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60"];
const CAPACITIES = [6, 7, 8, 10];
type Site = { id: string; name: string; address: string };
type Load = { load_number: number; quantity_m3: number; suggested_arrival: string };
type PourPlan = {
  id: string; site_id: string; site_name: string; site_address: string; grade: string; total_quantity_m3: number;
  mixer_capacity_m3: number; pour_date: string; start_time: string; unload_minutes: number; discharge_mode: "PUMP" | "DIRECT";
  loads_count: number; loads: Load[]; estimated_end_time?: string; status: string; notes?: string | null;
};
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
const timeAt = (start: string, offsetMinutes: number) => {
  const [h, m] = start.split(":").map(Number); const total = h * 60 + m + offsetMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export default function CustomerPourPlanner() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const sites = useGet<{ sites: Site[] }>("/master/customer/sites");
  const plans = useGet<{ plans: PourPlan[] }>("/customer/pour-plans");
  const [siteId, setSiteId] = useState<string | null>(null);
  const [grade, setGrade] = useState("M25");
  const [quantity, setQuantity] = useState("30");
  const [capacity, setCapacity] = useState(6);
  const [pourDate, setPourDate] = useState(tomorrow());
  const [startTime, setStartTime] = useState("10:00");
  const [unloadMinutes, setUnloadMinutes] = useState("30");
  const [mode, setMode] = useState<"PUMP" | "DIRECT">("PUMP");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const site = (sites.data?.sites || []).find((item) => item.id === siteId);
  const qty = Math.max(0, Number(quantity) || 0);
  const interval = Math.max(0, Number(unloadMinutes) || 0);
  const preview = useMemo(() => {
    if (!qty || !capacity || !interval) return [];
    const count = Math.ceil(qty / capacity);
    return Array.from({ length: Math.min(count, 500) }, (_, index) => ({
      load_number: index + 1,
      quantity_m3: Math.round(Math.min(capacity, qty - index * capacity) * 100) / 100,
      suggested_arrival: timeAt(startTime, index * interval),
    }));
  }, [capacity, interval, qty, startTime]);
  const estimatedEnd = preview.length ? timeAt(startTime, preview.length * interval) : "—";

  const save = async () => {
    if (!token) return;
    if (!siteId) return toast("Select a saved project site", "error");
    if (!qty || interval < 5 || interval > 180 || preview.length > 500) return toast("Check quantity and unloading time", "error");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pourDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return toast("Use valid date and 24-hour time", "error");
    setBusy(true);
    try {
      await apiPost("/customer/pour-plans", token, {
        site_id: siteId, grade, total_quantity_m3: qty, mixer_capacity_m3: capacity,
        pour_date: pourDate, start_time: startTime, unload_minutes: interval,
        discharge_mode: mode, notes: notes.trim() || null,
      });
      toast("Pour plan saved to this project", "success");
      plans.refetch();
    } catch (e: any) { toast(e.detail || "Could not save pour plan", "error"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!token) return;
    try { await apiDelete(`/customer/pour-plans/${id}`, token); toast("Pour plan removed", "success"); plans.refetch(); }
    catch (e: any) { toast(e.detail || "Could not remove plan", "error"); }
  };

  const share = async (plan?: PourPlan) => {
    const selectedSite = plan?.site_name || site?.name || "Project site";
    const selectedGrade = plan?.grade || grade; const total = plan?.total_quantity_m3 || qty;
    const count = plan?.loads_count || preview.length; const date = plan?.pour_date || pourDate;
    const start = plan?.start_time || startTime; const end = plan?.estimated_end_time || estimatedEnd;
    await Share.share({ message: `TrackMyRMC Pour Plan\n${selectedSite}\n${selectedGrade} · ${total} m³\n${count} mixer loads\n${date}, ${start}–${end}\nPlanning estimate only. Final dispatch sequence must be confirmed by the RMC plant.` });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.divider }]}><Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.onSurface} /></Pressable><View style={{ flex: 1 }}><AppText style={[styles.headerTitle, { color: colors.onSurface }]}>Concrete Pour Planner</AppText><AppText style={[styles.headerSub, { color: colors.onSurfaceSecondary }]}>Plan mixer loads and site arrival intervals</AppText></View><Ionicons name="time-outline" size={26} color={colors.brand} /></View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 110, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { sites.refetch(); plans.refetch(); }} tintColor={colors.brand} />} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: spacing.md }}>
          <AppText variant="heading">Pour requirement</AppText>
          <AppText variant="label">Project site</AppText>
          {(sites.data?.sites || []).length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{sites.data?.sites.map((item) => <Chip key={item.id} label={item.name} selected={siteId === item.id} onPress={() => setSiteId(item.id)} />)}</ScrollView> : <Button label="Add a saved site" variant="outline" onPress={() => router.push("/customer/sites")} />}
          {site ? <AppText variant="caption">{site.address}</AppText> : null}
          <AppText variant="label">Concrete grade</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{GRADES.map((item) => <Chip key={item} label={item} selected={grade === item} onPress={() => setGrade(item)} />)}</ScrollView>
          <Input label="Total quantity (m³)" value={quantity} onChangeText={(v) => setQuantity(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
          <AppText variant="label">Expected mixer capacity</AppText>
          <View style={styles.wrap}>{CAPACITIES.map((item) => <Chip key={item} label={`${item} m³`} selected={capacity === item} onPress={() => setCapacity(item)} />)}</View>
          <View style={styles.actions}><View style={{ flex: 1 }}><Input label="Pour date" value={pourDate} onChangeText={setPourDate} placeholder="YYYY-MM-DD" /></View><View style={{ flex: 1 }}><Input label="Start time" value={startTime} onChangeText={setStartTime} placeholder="HH:MM" /></View></View>
          <Input label="Minutes between mixer arrivals" value={unloadMinutes} onChangeText={(v) => setUnloadMinutes(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" />
          <View style={styles.actions}><View style={{ flex: 1 }}><Chip label="Pump" selected={mode === "PUMP"} onPress={() => setMode("PUMP")} /></View><View style={{ flex: 1 }}><Chip label="Direct discharge" selected={mode === "DIRECT"} onPress={() => setMode("DIRECT")} /></View></View>
          <Input label="Site notes (optional)" value={notes} onChangeText={setNotes} placeholder="Access, pump location, pour sequence…" />
        </Card>

        <Card style={{ gap: spacing.md }}>
          <View style={styles.between}><View><AppText variant="caption">Suggested load plan</AppText><AppText style={[styles.result, { color: colors.brand }]}>{preview.length} loads</AppText></View><View style={{ alignItems: "flex-end" }}><AppText variant="caption">Estimated completion</AppText><AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl }}>{estimatedEnd}</AppText></View></View>
          {preview.slice(0, 20).map((load) => <View key={load.load_number} style={[styles.loadRow, { borderColor: colors.border }]}><View style={[styles.loadNumber, { backgroundColor: colors.brandSoft }]}><AppText style={{ fontFamily: fonts.semibold, color: colors.brand }}>{load.load_number}</AppText></View><View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold }}>Mixer load {load.load_number}</AppText><AppText variant="caption">Suggested arrival {load.suggested_arrival}</AppText></View><AppText style={{ fontFamily: fonts.displayBold }}>{load.quantity_m3} m³</AppText></View>)}
          {preview.length > 20 ? <AppText variant="caption">Showing the first 20 of {preview.length} planned loads.</AppText> : null}
          <View style={styles.notice}><Ionicons name="warning-outline" size={19} color={colors.warning} /><AppText variant="caption" style={{ flex: 1 }}>This timeline is an estimate. The plant must confirm mixer availability, route time, dispatch sequence and practical unloading interval.</AppText></View>
          <Button label="Save Pour Plan" onPress={save} loading={busy} />
          <Button label="Share Summary" variant="outline" onPress={() => share()} />
          <View style={styles.actions}><View style={{ flex: 1 }}><Button label="Compare Plants" variant="outline" onPress={() => router.push({ pathname: "/customer/compare-plants", params: { siteId: siteId || "", grade, quantity } } as any)} /></View><View style={{ flex: 1 }}><Button label="Use in Order" onPress={() => router.push({ pathname: "/new-order", params: { siteId: siteId || "", siteName: site?.name || "", siteAddress: site?.address || "", grade, quantity, deliveryDate: pourDate, deliveryTime: startTime } } as any)} /></View></View>
        </Card>

        <View style={styles.between}><AppText variant="heading">Saved Pour Plans</AppText><Badge label={String(plans.data?.plans.length || 0)} color={colors.brand} /></View>
        {plans.loading && !plans.data ? <Skeleton height={150} /> : null}
        {plans.data?.plans.map((plan) => <Card key={plan.id} style={{ gap: spacing.sm }}><View style={styles.between}><View style={{ flex: 1 }}><AppText variant="heading">{plan.site_name}</AppText><AppText variant="caption">{plan.pour_date} · {plan.start_time} · {plan.discharge_mode.toLowerCase()}</AppText></View><Badge label={plan.status} status={plan.status} /></View><View style={[styles.summary, { backgroundColor: colors.surfaceTertiary }]}><AppText style={{ fontFamily: fonts.displayBold }}>{plan.grade} · {plan.total_quantity_m3} m³</AppText><AppText variant="caption">{plan.loads_count} loads · {plan.mixer_capacity_m3} m³ mixer · {plan.unload_minutes} min interval</AppText></View><View style={styles.actions}><View style={{ flex: 1 }}><Button label="Compare" variant="outline" onPress={() => router.push({ pathname: "/customer/compare-plants", params: { siteId: plan.site_id, grade: plan.grade, quantity: String(plan.total_quantity_m3) } } as any)} /></View><View style={{ flex: 1 }}><Button label="Create Order" onPress={() => router.push({ pathname: "/new-order", params: { siteId: plan.site_id, siteName: plan.site_name, siteAddress: plan.site_address, grade: plan.grade, quantity: String(plan.total_quantity_m3), deliveryDate: plan.pour_date, deliveryTime: plan.start_time } } as any)} /></View></View><View style={styles.actions}><View style={{ flex: 1 }}><Button label="Delete" variant="outline" onPress={() => remove(plan.id)} /></View><View style={{ flex: 1 }}><Button label="Share" variant="outline" onPress={() => share(plan)} /></View></View></Card>)}
        {plans.data && plans.data.plans.length === 0 ? <Card style={styles.empty}><Ionicons name="time-outline" size={32} color={colors.onSurfaceTertiary} /><AppText variant="heading">No saved pour plans</AppText><AppText variant="caption">Your saved mixer timeline will appear here.</AppText></Card> : null}
      </ScrollView>
    </View>
  );
}
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) { const { colors } = useTheme(); return <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}><AppText style={{ fontFamily: fonts.semibold, color: selected ? colors.onBrand : colors.onSurface }}>{label}</AppText></Pressable>; }
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth }, headerTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl }, headerSub: { fontSize: 12 },
  chip: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" }, wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.sm }, between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  result: { fontFamily: fonts.displayBold, fontSize: 32 }, loadRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm },
  loadNumber: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" }, notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  summary: { padding: spacing.md, borderRadius: radius.md, gap: 4 }, empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"] },
});
