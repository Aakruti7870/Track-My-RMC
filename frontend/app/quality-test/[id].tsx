import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Inspection = {
  id: string; slump_mm: number | null; cube_7d: number | null; cube_28d: number | null;
  actual_cement: number | null; actual_water: number | null; result: string | null;
  remarks: string | null; record_source: string; tester_name: string | null;
  sample_date: string; testing_date: string | null; recorded_at: string;
};
type Detail = { order_number: string; grade: string; quantity: number; site_name: string; quality_tests: Inspection[] };

export default function QualityTest() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canRecord = user?.role === "quality_engineer";
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slump, setSlump] = useState("");
  const [c7, setC7] = useState("");
  const [c28, setC28] = useState("");
  const [cement, setCement] = useState("");
  const [water, setWater] = useState("");
  const [result, setResult] = useState<"PASS" | "FAIL" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [sampleDate, setSampleDate] = useState(new Date().toISOString().slice(0, 10));
  const [testedOn, setTestedOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (!token || !id) return;
    try { setError(null); setDetail(await apiGet<Detail>("/staff/quality/" + id, token)); }
    catch { setError("Could not load quality records. Try again."); }
  }, [id, token]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!token || !canRecord || busy.current) return;
    const fields = [[slump, 1000], [c7, 1000], [c28, 1000], [cement, 2000], [water, 2000]] as const;
    if (!result || !fields.some(([text]) => text.trim()) || fields.some(([text, max]) => text.trim() &&
      (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) > max)) || (slump && !/^\d+$/.test(slump))) {
      toast("Enter a valid measurement and select the engineer assessment.", "error"); return;
    }
    const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    if (!validDate(sampleDate) || !validDate(testedOn) || sampleDate > testedOn || testedOn > new Date().toISOString().slice(0, 10)) {
      toast("Enter valid sample and test dates in chronological order.", "error"); return;
    }
    const payload = { order_id: id, slump_mm: slump ? Number(slump) : null, cube_7d: c7 ? Number(c7) : null,
      cube_28d: c28 ? Number(c28) : null, actual_cement: cement ? Number(cement) : null,
      actual_water: water ? Number(water) : null, result, remarks: remarks.trim() || null,
      sample_date: sampleDate, tested_on: testedOn };
    const body = JSON.stringify(payload);
    if (retry.current?.body !== body) retry.current = { body, key: "quality-" + Date.now() + "-" + Math.random().toString(36).slice(2) };
    busy.current = true; setSaving(true);
    try {
      await apiPost("/staff/quality", token, { ...payload, request_id: retry.current.key });
      retry.current = null; setSlump(""); setC7(""); setC28(""); setCement(""); setWater(""); setResult(null); setRemarks("");
      toast("Engineer inspection saved", "success"); await load();
    } catch { toast("Could not save. Your entries are kept for retry.", "error"); }
    finally { busy.current = false; setSaving(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="qt-back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">Quality Records</AppText>
      </View>
      {error ? <View style={{ padding: spacing.lg, gap: spacing.md }}><AppText>{error}</AppText><Button label="Retry" onPress={() => void load()} /></View> : !detail ? (
        <View style={{ padding: spacing.lg }}><Skeleton height={200} style={{ borderRadius: radius.lg }} /></View>
      ) : (
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["3xl"] }}>
          <Card style={{ gap: 4 }}><AppText variant="heading">{detail.grade} · {detail.order_number}</AppText><AppText variant="caption">{detail.quantity} m³ — {detail.site_name}</AppText></Card>
          {canRecord && <View style={{ gap: spacing.md }}>
            <AppText variant="heading">New engineer inspection</AppText>
            <AppText variant="caption">Enter measured values and your assessment. Each save adds a record. Previous measurements are kept in history.</AppText>
            <Input testID="qt-slump" label="Slump (mm)" value={slump} onChangeText={setSlump} keyboardType="numeric" editable={!saving} />
            <Input testID="qt-cement" label="Cement (kg/m³)" value={cement} onChangeText={setCement} keyboardType="numeric" editable={!saving} />
            <Input testID="qt-cube7" label="7-day (MPa)" value={c7} onChangeText={setC7} keyboardType="numeric" editable={!saving} />
            <Input testID="qt-cube28" label="28-day (MPa)" value={c28} onChangeText={setC28} keyboardType="numeric" editable={!saving} />
            <Input testID="qt-water" label="Water (L/m³)" value={water} onChangeText={setWater} keyboardType="numeric" editable={!saving} />
            <Input testID="qt-sample-date" label="Sample date (YYYY-MM-DD)" value={sampleDate} onChangeText={setSampleDate} editable={!saving} />
            <Input testID="qt-tested-on" label="Test date (YYYY-MM-DD)" value={testedOn} onChangeText={setTestedOn} editable={!saving} />
            <AppText variant="label">Engineer assessment (required)</AppText>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {(["PASS", "FAIL"] as const).map(r => <Pressable key={r} testID={"qt-result-" + r} accessibilityRole="button" accessibilityState={{ selected: result === r }} disabled={saving} onPress={() => setResult(r)} style={[styles.chip, { borderColor: colors.border, backgroundColor: result === r ? colors.brand : colors.surfaceSecondary }]}>
                <AppText style={{ fontFamily: fonts.semibold, color: result === r ? colors.onBrand : colors.onSurface }}>{r}</AppText>
              </Pressable>)}
            </View>
            <Input testID="qt-remarks" label="Remarks (optional)" value={remarks} onChangeText={setRemarks} maxLength={2000} editable={!saving} />
            <Button testID="qt-save" label="Save Quality Test" onPress={submit} loading={saving} disabled={!result} />
          </View>}
          <View testID="qt-history" style={{ gap: spacing.md }}>
            <AppText variant="heading">Inspection history</AppText>
            {detail.quality_tests.length === 0 && <AppText variant="bodyMuted">No quality inspections recorded.</AppText>}
            {detail.quality_tests.map(test => <View key={test.id} testID={"qt-history-" + test.id}><Card style={{ gap: spacing.sm }}>
              <AppText variant="label">{test.record_source === "ENGINEER_INSPECTION" ? "Engineer assessment: " + (test.result ?? "Unrecorded") : "Legacy record — provenance unverified"}</AppText>
              <AppText variant="caption">{test.tester_name || "Recorder unavailable"} · Recorded {new Date(test.recorded_at).toLocaleString()}</AppText>
              <AppText variant="caption">Sample {test.sample_date} · Test {test.testing_date || "Unrecorded"}</AppText>
              <AppText>Slump: {test.slump_mm ?? "—"} mm · 7-day: {test.cube_7d ?? "—"} MPa · 28-day: {test.cube_28d ?? "—"} MPa</AppText>
              <AppText>Cement: {test.actual_cement ?? "—"} kg/m³ · Water: {test.actual_water ?? "—"} L/m³</AppText>
              {test.remarks && <AppText>{test.remarks}</AppText>}
            </Card></View>)}
          </View>
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  chip: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
