import React, { useEffect, useState } from "react";
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

type Detail = {
  order_number: string;
  grade: string;
  quantity: number;
  site_name: string;
  test: null | {
    slump_mm?: number; cube_7d?: number; cube_28d?: number;
    actual_cement?: number; actual_water?: number; result?: string; remarks?: string;
  };
};

export default function QualityTest() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [slump, setSlump] = useState("");
  const [c7, setC7] = useState("");
  const [c28, setC28] = useState("");
  const [cement, setCement] = useState("");
  const [water, setWater] = useState("");
  const [result, setResult] = useState<"PASS" | "FAIL">("PASS");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiGet<Detail>(`/staff/quality/${id}`, token!);
        setDetail(d);
        if (d.test) {
          setSlump(d.test.slump_mm?.toString() || "");
          setC7(d.test.cube_7d?.toString() || "");
          setC28(d.test.cube_28d?.toString() || "");
          setCement(d.test.actual_cement?.toString() || "");
          setWater(d.test.actual_water?.toString() || "");
          setResult((d.test.result as any) || "PASS");
          setRemarks(d.test.remarks || "");
        }
      } catch (e: any) {
        toast(e.detail || "Could not load", "error");
      }
    })();
  }, [id]);

  const submit = async () => {
    setSaving(true);
    try {
      await apiPost("/staff/quality", token!, {
        order_id: id,
        slump_mm: slump ? Number(slump) : null,
        cube_7d: c7 ? Number(c7) : null,
        cube_28d: c28 ? Number(c28) : null,
        actual_cement: cement ? Number(cement) : null,
        actual_water: water ? Number(water) : null,
        result,
        remarks: remarks.trim() || null,
      });
      toast("Quality test saved", "success");
      router.back();
    } catch (e: any) {
      toast(e.detail || "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="qt-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">Quality Test</AppText>
      </View>

      {!detail ? (
        <View style={{ padding: spacing.lg }}><Skeleton height={200} style={{ borderRadius: radius.lg }} /></View>
      ) : (
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
          <Card style={{ gap: 4 }}>
            <AppText variant="heading">{detail.grade} · {detail.order_number}</AppText>
            <AppText variant="caption">{detail.quantity} m³ — {detail.site_name}</AppText>
          </Card>

          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}><Input label="Slump (mm)" value={slump} onChangeText={(t) => setSlump(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" /></View>
            <View style={{ flex: 1 }}><Input label="Cement (kg/m³)" value={cement} onChangeText={(t) => setCement(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" /></View>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}><Input label="7-day (MPa)" value={c7} onChangeText={(t) => setC7(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" /></View>
            <View style={{ flex: 1 }}><Input label="28-day (MPa)" value={c28} onChangeText={(t) => setC28(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" /></View>
          </View>
          <Input label="Water (L/m³)" value={water} onChangeText={(t) => setWater(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" />

          <View style={{ gap: spacing.sm }}>
            <AppText variant="label">Result</AppText>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {(["PASS", "FAIL"] as const).map((r) => {
                const sel = result === r;
                const c = r === "PASS" ? colors.success : colors.error;
                return (
                  <Pressable key={r} testID={`qt-result-${r}`} onPress={() => setResult(r)} style={[styles.chip, { backgroundColor: sel ? c : colors.surfaceSecondary, borderColor: sel ? c : colors.border }]}>
                    <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, color: sel ? "#fff" : colors.onSurfaceSecondary }}>{r}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Input label="Remarks (optional)" value={remarks} onChangeText={setRemarks} placeholder="Observations" />
          <Button testID="qt-save" label="Save Quality Test" onPress={submit} loading={saving} icon={<Ionicons name="save-outline" size={18} color={colors.onBrand} />} />
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  chip: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
