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

type Tab = "GUIDE" | "RECORD" | "SAVED";
type Site = { id: string; name: string; address: string };
type Order = { id: string; order_number?: string; site_id?: string; grade: string; quantity: number; status: string };
type RecordItem = {
  id: string; site_id: string; site_name: string; order_id?: string; order_number?: string; grade: string;
  received_quantity_m3: number; challan_number?: string; tm_number?: string; arrival_time?: string;
  observed_slump_mm?: number | null; cube_sample_ids: string[]; sample_cast_date?: string;
  cube_7d_date?: string; cube_28d_date?: string; checklist: Record<string, boolean>; notes?: string;
  record_type: string; created_at: string;
};
const GRADES = ["M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60"];
const CHECKS = [
  ["challan", "Challan, plant, grade and ordered quantity checked"],
  ["tm", "Transit mixer number and visible condition checked"],
  ["seal", "Seal / delivery identification checked where applicable"],
  ["time", "Arrival and unloading times recorded"],
  ["visual", "Concrete visually observed before discharge"],
  ["access", "Safe access, pump/discharge area and workforce ready"],
] as const;
const today = () => new Date().toISOString().slice(0, 10);

export default function ConcreteReceivingGuide() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const sites = useGet<{ sites: Site[] }>("/master/customer/sites");
  const orders = useGet<{ orders: Order[] }>("/customer/orders");
  const records = useGet<{ records: RecordItem[] }>("/customer/receiving-records");
  const [tab, setTab] = useState<Tab>("GUIDE");
  const [siteId, setSiteId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [grade, setGrade] = useState("M25");
  const [quantity, setQuantity] = useState("");
  const [challan, setChallan] = useState("");
  const [tm, setTm] = useState("");
  const [arrival, setArrival] = useState("");
  const [unloadStart, setUnloadStart] = useState("");
  const [unloadEnd, setUnloadEnd] = useState("");
  const [slump, setSlump] = useState("");
  const [cubeIds, setCubeIds] = useState("");
  const [castDate, setCastDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const site = sites.data?.sites.find((item) => item.id === siteId);
  const siteOrders = useMemo(() => (orders.data?.orders || []).filter((item) => !siteId || item.site_id === siteId), [orders.data, siteId]);
  const completed = CHECKS.filter(([key]) => checklist[key]).length;

  const selectOrder = (order: Order) => {
    setOrderId(order.id); setGrade(order.grade); setQuantity(String(order.quantity));
    if (order.site_id) setSiteId(order.site_id);
  };

  const save = async () => {
    if (!token) return;
    if (!siteId) return toast("Select a saved project site", "error");
    if (!(Number(quantity) > 0)) return toast("Enter received quantity", "error");
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if ([arrival, unloadStart, unloadEnd].some((value) => value && !timePattern.test(value))) return toast("Use HH:MM for recorded times", "error");
    setBusy(true);
    try {
      await apiPost("/customer/receiving-records", token, {
        site_id: siteId, order_id: orderId, grade, received_quantity_m3: Number(quantity),
        challan_number: challan.trim() || null, tm_number: tm.trim() || null,
        arrival_time: arrival || null, unloading_start_time: unloadStart || null, unloading_end_time: unloadEnd || null,
        observed_slump_mm: slump ? Number(slump) : null,
        cube_sample_ids: cubeIds.split(",").map((value) => value.trim()).filter(Boolean),
        sample_cast_date: cubeIds.trim() ? castDate : null, checklist, notes: notes.trim() || null,
      });
      toast("Customer observation saved", "success"); records.refetch(); setTab("SAVED");
    } catch (e: any) { toast(e.detail || "Could not save receiving record", "error"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!token) return;
    try { await apiDelete(`/customer/receiving-records/${id}`, token); toast("Record removed", "success"); records.refetch(); }
    catch (e: any) { toast(e.detail || "Could not remove record", "error"); }
  };

  const share = async (item: RecordItem) => Share.share({ message:
    `TrackMyRMC Customer Receiving Observation\n${item.site_name}\nOrder: ${item.order_number || "Not linked"}\n${item.grade} · ${item.received_quantity_m3} m³\nChallan: ${item.challan_number || "—"} · TM: ${item.tm_number || "—"}\nObserved slump: ${item.observed_slump_mm ?? "Not recorded"} mm\nCube IDs: ${item.cube_sample_ids?.join(", ") || "Not recorded"}\nCustomer observation only—not an official acceptance or laboratory report.`
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.divider }]}><Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.onSurface} /></Pressable><View style={{ flex: 1 }}><AppText style={[styles.headerTitle, { color: colors.onSurface }]}>Concrete Receiving Guide</AppText><AppText style={[styles.headerSub, { color: colors.onSurfaceSecondary }]}>Observe, record and follow the approved project specification</AppText></View><Ionicons name="shield-checkmark-outline" size={26} color={colors.brand} /></View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 110, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { sites.refetch(); orders.refetch(); records.refetch(); }} tintColor={colors.brand} />} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{([["GUIDE","Guide"],["RECORD","New Record"],["SAVED","Saved Records"]] as [Tab,string][]).map(([key,label]) => <Chip key={key} label={label} selected={tab === key} onPress={() => setTab(key)} />)}</ScrollView>

        {tab === "GUIDE" ? <>
          <SafetyCard />
          <Guide title="1. Before the mixer arrives" icon="clipboard-outline" items={["Confirm approved grade, quantity, pour location and discharge method.", "Keep access, formwork, reinforcement, labour, vibrator and finishing tools ready.", "Confirm who is authorised to inspect and accept concrete for the project."]} />
          <Guide title="2. At receiving" icon="car-outline" items={["Match the delivery challan with the order and project site.", "Record mixer/challan identity and arrival time before discharge.", "Escalate visible contamination, unauthorised water addition, wrong grade or documentation mismatch to the responsible engineer and plant."]} />
          <Guide title="3. Slump observation" icon="beaker-outline" items={["Sampling and consistency testing should follow the applicable IS 1199 series and project method statement.", "Use clean, suitable equipment on a stable surface and have trained personnel perform the test.", "Record the measured value; compare only with the approved mix specification. This app does not decide Pass or Fail."]} />
          <Guide title="4. Cube samples" icon="cube-outline" items={["Use unique sample IDs linked to the pour, location, grade, date and challan.", "Sampling, specimen preparation, curing and compressive-strength testing should follow the applicable IS 1199 and IS 516 series.", "Laboratory results and acceptance decisions belong to authorised quality professionals."]} />
          <Guide title="5. Placement and curing" icon="water-outline" items={["Prevent uncontrolled retempering or water addition at site.", "Place and compact concrete using the approved method without harmful delay or segregation.", "Start and maintain the specified curing method as soon as the finished surface permits; duration depends on the approved specification, cement, exposure and weather."]} />
          <Card><AppText variant="caption">References: IS 456:2000 for plain and reinforced concrete practice; applicable parts of the IS 1199 series for fresh-concrete sampling/testing; applicable parts of the IS 516 series for hardened-concrete strength testing. Always check the latest project-approved editions and amendments.</AppText></Card>
        </> : tab === "RECORD" ? <>
          <SafetyCard />
          <Card style={{ gap: spacing.md }}>
            <AppText variant="heading">Delivery identification</AppText>
            <AppText variant="label">Saved project site</AppText>
            {(sites.data?.sites || []).length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{sites.data?.sites.map((item) => <Chip key={item.id} label={item.name} selected={siteId === item.id} onPress={() => { setSiteId(item.id); setOrderId(null); }} />)}</ScrollView> : <Button label="Add Saved Site" variant="outline" onPress={() => router.push("/customer/sites")} />}
            {site ? <AppText variant="caption">{site.address}</AppText> : null}
            <AppText variant="label">Link order (optional)</AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{siteOrders.slice(0,20).map((item) => <Chip key={item.id} label={item.order_number || item.id} selected={orderId === item.id} onPress={() => selectOrder(item)} />)}</ScrollView>
            <AppText variant="label">Grade</AppText><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{GRADES.map((item) => <Chip key={item} label={item} selected={grade === item} onPress={() => setGrade(item)} />)}</ScrollView>
            <Input label="Received quantity (m³)" value={quantity} onChangeText={(v) => setQuantity(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
            <View style={styles.actions}><View style={{ flex: 1 }}><Input label="Challan number" value={challan} onChangeText={setChallan} /></View><View style={{ flex: 1 }}><Input label="TM number" value={tm} onChangeText={setTm} /></View></View>
            <Input label="Arrival time (HH:MM)" value={arrival} onChangeText={setArrival} /><View style={styles.actions}><View style={{ flex: 1 }}><Input label="Unload start" value={unloadStart} onChangeText={setUnloadStart} /></View><View style={{ flex: 1 }}><Input label="Unload end" value={unloadEnd} onChangeText={setUnloadEnd} /></View></View>
          </Card>
          <Card style={{ gap: spacing.md }}><View style={styles.between}><AppText variant="heading">Receiving checklist</AppText><Badge label={`${completed}/${CHECKS.length}`} status={completed === CHECKS.length ? "DELIVERED" : "PENDING"} /></View>{CHECKS.map(([key,label]) => <Pressable key={key} onPress={() => setChecklist((value) => ({ ...value, [key]: !value[key] }))} style={[styles.checkRow, { borderColor: colors.border }]}><Ionicons name={checklist[key] ? "checkbox" : "square-outline"} size={22} color={checklist[key] ? colors.success : colors.onSurfaceTertiary} /><AppText style={{ flex: 1 }}>{label}</AppText></Pressable>)}</Card>
          <Card style={{ gap: spacing.md }}><AppText variant="heading">Site observations</AppText><Input label="Observed slump (mm, optional)" value={slump} onChangeText={(v) => setSlump(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" /><AppText variant="caption">The app records a value only. It does not determine acceptance.</AppText><Input label="Cube sample IDs (comma separated)" value={cubeIds} onChangeText={setCubeIds} placeholder="e.g. A1, A2, A3" /><Input label="Sample casting date" value={castDate} onChangeText={setCastDate} placeholder="YYYY-MM-DD" /><Input label="Notes" value={notes} onChangeText={setNotes} placeholder="Observations and escalation details" /><Button label="Save Customer Observation" onPress={save} loading={busy} /></Card>
        </> : <>
          <SafetyCard />
          {records.loading && !records.data ? <Skeleton height={160} /> : null}
          {records.data?.records.map((item) => <Card key={item.id} style={{ gap: spacing.sm }}><View style={styles.between}><View style={{ flex: 1 }}><AppText variant="heading">{item.site_name}</AppText><AppText variant="caption">{new Date(item.created_at).toLocaleString("en-IN")} · {item.order_number || "No linked order"}</AppText></View><Badge label="Observation" color={colors.brand} /></View><View style={[styles.summary, { backgroundColor: colors.surfaceTertiary }]}><AppText style={{ fontFamily: fonts.displayBold }}>{item.grade} · {item.received_quantity_m3} m³</AppText><AppText variant="caption">Challan {item.challan_number || "—"} · TM {item.tm_number || "—"} · Arrival {item.arrival_time || "—"}</AppText></View>{item.observed_slump_mm != null ? <AppText variant="caption">Observed slump: {item.observed_slump_mm} mm — no automatic result</AppText> : null}{item.cube_sample_ids?.length ? <AppText variant="caption">Cube IDs: {item.cube_sample_ids.join(", ")} · planned dates {item.cube_7d_date} / {item.cube_28d_date}</AppText> : null}<View style={styles.actions}><View style={{ flex: 1 }}><Button label="Delete" variant="outline" onPress={() => remove(item.id)} /></View><View style={{ flex: 1 }}><Button label="Share" variant="outline" onPress={() => share(item)} /></View></View></Card>)}
          {records.data && records.data.records.length === 0 ? <Card style={styles.empty}><Ionicons name="clipboard-outline" size={32} color={colors.onSurfaceTertiary} /><AppText variant="heading">No receiving records</AppText><AppText variant="caption">Customer observations saved at delivery will appear here.</AppText></Card> : null}
        </>}
      </ScrollView>
    </View>
  );
}
function SafetyCard() { const { colors } = useTheme(); return <Card style={{ gap: spacing.sm, borderColor: colors.warning }}><View style={styles.notice}><Ionicons name="warning-outline" size={20} color={colors.warning} /><AppText variant="caption" style={{ flex: 1 }}>Customer observation only. Do not use this screen as structural approval, official quality certification or an instruction to reject concrete. Follow the engineer, approved mix specification and project quality plan.</AppText></View></Card>; }
function Guide({ title, icon, items }: { title: string; icon: keyof typeof Ionicons.glyphMap; items: string[] }) { const { colors } = useTheme(); return <Card style={{ gap: spacing.md }}><View style={styles.guideTitle}><Ionicons name={icon} size={21} color={colors.brand} /><AppText variant="heading">{title}</AppText></View>{items.map((item,index) => <View key={index} style={styles.guideRow}><View style={[styles.dot,{backgroundColor:colors.brand}]} /><AppText variant="caption" style={{ flex: 1 }}>{item}</AppText></View>)}</Card>; }
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) { const { colors } = useTheme(); return <Pressable onPress={onPress} style={[styles.chip,{backgroundColor:selected?colors.brand:colors.surfaceSecondary,borderColor:selected?colors.brand:colors.border}]}><AppText style={{fontFamily:fonts.semibold,color:selected?colors.onBrand:colors.onSurface}}>{label}</AppText></Pressable>; }
const styles=StyleSheet.create({
  header:{flexDirection:"row",alignItems:"center",gap:spacing.md,padding:spacing.lg,paddingTop:spacing.md,borderBottomWidth:StyleSheet.hairlineWidth},headerTitle:{fontFamily:fonts.displayBold,fontSize:fontSize.xl},headerSub:{fontSize:12},
  chip:{minHeight:40,paddingHorizontal:spacing.lg,borderRadius:radius.pill,borderWidth:1,alignItems:"center",justifyContent:"center"},notice:{flexDirection:"row",alignItems:"flex-start",gap:spacing.sm},guideTitle:{flexDirection:"row",alignItems:"center",gap:spacing.sm},guideRow:{flexDirection:"row",alignItems:"flex-start",gap:spacing.sm},dot:{width:7,height:7,borderRadius:4,marginTop:5},
  actions:{flexDirection:"row",gap:spacing.sm},between:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.md},checkRow:{minHeight:54,flexDirection:"row",alignItems:"center",gap:spacing.md,borderWidth:1,borderRadius:radius.md,padding:spacing.md},summary:{padding:spacing.md,borderRadius:radius.md,gap:4},empty:{alignItems:"center",gap:spacing.sm,paddingVertical:spacing["2xl"]},
});
