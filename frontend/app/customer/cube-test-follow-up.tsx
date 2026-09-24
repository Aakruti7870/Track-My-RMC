import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPatch } from "@/src/api/client";
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

type FollowUp = { sample_id: string; age_days: 7 | 28; due_date: string; status: "UPCOMING" | "DUE" | "OVERDUE" | "RECORDED" };
type Result = { sample_id: string; age_days: 7 | 28; tested_on: string; result_mpa: number; lab_name?: string; report_reference?: string; notes?: string };
type RecordItem = {
  id: string; site_name: string; order_number?: string; grade: string; sample_cast_date?: string;
  cube_sample_ids: string[]; cube_follow_up: FollowUp[]; cube_test_results?: Result[];
  pending_cube_tests: number; overdue_cube_tests: number;
};
const today = () => new Date().toISOString().slice(0, 10);

export default function CubeTestFollowUp() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const records = useGet<{ records: RecordItem[] }>("/customer/receiving-records");
  const [selected, setSelected] = useState<{ recordId: string; sampleId: string; ageDays: 7 | 28 } | null>(null);
  const [testedOn, setTestedOn] = useState(today());
  const [resultMpa, setResultMpa] = useState("");
  const [labName, setLabName] = useState("");
  const [reportReference, setReportReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const qualityRecords = useMemo(() => (records.data?.records || []).filter((item) => item.cube_follow_up?.length), [records.data]);
  const overdue = qualityRecords.reduce((sum, item) => sum + Number(item.overdue_cube_tests || 0), 0);
  const pending = qualityRecords.reduce((sum, item) => sum + Number(item.pending_cube_tests || 0), 0);

  const save = async () => {
    if (!token || !selected) return;
    if (!(Number(resultMpa) > 0)) return toast("Enter the laboratory result in MPa", "error");
    setBusy(true);
    try {
      await apiPatch(`/customer/receiving-records/${selected.recordId}/cube-results`, token, {
        sample_id: selected.sampleId,
        age_days: selected.ageDays,
        tested_on: testedOn,
        result_mpa: Number(resultMpa),
        lab_name: labName.trim() || null,
        report_reference: reportReference.trim() || null,
        notes: notes.trim() || null,
      });
      toast("Cube test result recorded", "success");
      setSelected(null); setResultMpa(""); setLabName(""); setReportReference(""); setNotes("");
      records.refetch();
    } catch (e: any) { toast(e.detail || "Could not record cube result", "error"); }
    finally { setBusy(false); }
  };

  const share = async (item: RecordItem) => {
    const results = (item.cube_test_results || []).map((r) => `${r.sample_id} · ${r.age_days} day · ${r.result_mpa} MPa · ${r.tested_on}`).join("\n");
    await Share.share({ message: `TrackMyRMC Cube Test Follow-up\n${item.site_name}\nOrder: ${item.order_number || "Not linked"} · ${item.grade}\n${results || "No results recorded"}\n\nRecorded information only. Acceptance remains with the authorised engineer/laboratory and approved project specification.` });
  };

  return <View style={{ flex: 1, backgroundColor: colors.surface }}>
    <View style={{ height: insets.top }} />
    <View style={[styles.header, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.divider }]}>
      <Pressable onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.onSurface} /></Pressable>
      <View style={{ flex: 1 }}><AppText style={[styles.headerTitle, { color: colors.onSurface }]}>Cube Test Follow-up</AppText><AppText style={[styles.headerSub, { color: colors.onSurfaceTertiary }]}>7-day and 28-day quality records</AppText></View>
      <Ionicons name="flask-outline" size={26} color={colors.brand} />
    </View>
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 110, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={records.refetch} tintColor={colors.brand} />} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: spacing.sm, borderColor: colors.warning }}>
        <View style={styles.notice}><Ionicons name="warning-outline" size={20} color={colors.warning} /><AppText variant="caption" style={{ flex: 1 }}>Record laboratory values without automatic Pass/Fail. Acceptance must follow the approved specification, latest applicable standards and authorised quality decision.</AppText></View>
      </Card>
      <View style={styles.metrics}>
        <Metric label="Pending" value={String(pending)} color={colors.brand} />
        <Metric label="Overdue" value={String(overdue)} color={overdue ? colors.error : colors.success} />
      </View>
      {records.loading && !records.data ? <Skeleton height={180} /> : null}
      {qualityRecords.map((item) => <Card key={item.id} style={{ gap: spacing.md }}>
        <View style={styles.between}><View style={{ flex: 1 }}><AppText variant="heading">{item.site_name}</AppText><AppText variant="caption">{item.order_number || "No linked order"} · {item.grade} · Cast {item.sample_cast_date || "—"}</AppText></View>{item.overdue_cube_tests ? <Badge label={`${item.overdue_cube_tests} overdue`} status="REJECTED" /> : <Badge label="Follow-up" color={colors.brand} />}</View>
        {(item.cube_follow_up || []).map((follow) => {
          const result = (item.cube_test_results || []).find((r) => r.sample_id.toLowerCase() === follow.sample_id.toLowerCase() && r.age_days === follow.age_days);
          return <View key={`${follow.sample_id}-${follow.age_days}`} style={[styles.followRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1, gap: 3 }}><AppText style={{ fontFamily: fonts.semibold }}>{follow.sample_id} · {follow.age_days}-day</AppText><AppText variant="caption">Due {follow.due_date}{result ? ` · ${result.result_mpa} MPa on ${result.tested_on}` : ""}</AppText></View>
            {follow.status === "RECORDED" ? <Badge label="Recorded" status="DELIVERED" /> : <Button label={follow.status === "OVERDUE" ? "Record overdue" : "Record"} variant="outline" onPress={() => { setSelected({ recordId: item.id, sampleId: follow.sample_id, ageDays: follow.age_days }); setTestedOn(today()); }} />}
          </View>;
        })}
        <Button label="Share Quality Summary" variant="ghost" onPress={() => share(item)} />
      </Card>)}
      {records.data && qualityRecords.length === 0 ? <Card style={styles.empty}><Ionicons name="cube-outline" size={34} color={colors.onSurfaceTertiary} /><AppText variant="heading">No cube follow-ups yet</AppText><AppText variant="caption" center>Add cube IDs and a casting date in the Concrete Receiving Guide first.</AppText><Button label="Open Receiving Guide" onPress={() => router.push("/customer/receiving-guide")} /></Card> : null}
      {selected ? <Card style={{ gap: spacing.md, borderColor: colors.brand }}>
        <View style={styles.between}><AppText variant="heading">{selected.sampleId} · {selected.ageDays}-day result</AppText><Pressable onPress={() => setSelected(null)}><Ionicons name="close" size={22} color={colors.onSurfaceSecondary} /></Pressable></View>
        <Input label="Test date" value={testedOn} onChangeText={setTestedOn} placeholder="YYYY-MM-DD" />
        <Input label="Compressive strength (MPa)" value={resultMpa} onChangeText={(v) => setResultMpa(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
        <Input label="Laboratory name (optional)" value={labName} onChangeText={setLabName} />
        <Input label="Report number or secure reference (optional)" value={reportReference} onChangeText={setReportReference} />
        <Input label="Notes (optional)" value={notes} onChangeText={setNotes} />
        <Button label="Save Recorded Result" onPress={save} loading={busy} />
      </Card> : null}
    </ScrollView>
  </View>;
}
function Metric({ label, value, color }: { label: string; value: string; color: string }) { const { colors } = useTheme(); return <Card style={{ flex: 1, alignItems: "center", gap: 4 }}><AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color }}>{value}</AppText><AppText variant="caption" style={{ color: colors.onSurfaceSecondary }}>{label}</AppText></Card>; }
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl }, headerSub: { fontSize: 12 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, metrics: { flexDirection: "row", gap: spacing.md },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  followRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing["2xl"] },
});
