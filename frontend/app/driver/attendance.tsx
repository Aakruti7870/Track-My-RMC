import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { useToast } from "@/src/components/ui/Toast";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { fonts, spacing } from "@/src/theme/tokens";

type Period = "daily" | "weekly" | "monthly";
type EntryKind = "diesel" | "odometer" | "maintenance";
type MaintenanceLog = { id: string; type: string; notes: string | null; recorded_at: string };
type Overview = {
  completed_trips: number;
  diesel_litres: number | null;
  odometer_km: number | null;
  maintenance_count: number;
  maintenance: MaintenanceLog[];
};
const MAINTENANCE = [
  ["oil_change", "Oil change"], ["puncture", "Puncture"], ["coolant", "Coolant"],
  ["urea", "Urea"], ["brakes", "Brakes"], ["tyres", "Tyres"],
  ["filter", "Filter"], ["service", "Service"], ["other", "Other"],
] as const;
const TILES: { label: string; kind: string; symbol: VectorSymbolName }[] = [
  { label: "Completed Trips", kind: "trips", symbol: "drop-offs" },
  { label: "Diesel Top Up", kind: "diesel", symbol: "diesel-ledger" },
  { label: "Odometer", kind: "odometer", symbol: "trip-history" },
  { label: "TM Maintenance", kind: "maintenance", symbol: "vehicle-maintenance" },
];

export default function DriverDropOffs() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<Period>("daily");
  const { data, loading, error, refetch } = useGet<Overview>(`/driver/drop-offs?period=${period}`);
  const [kind, setKind] = useState<EntryKind>("diesel");
  const [number, setNumber] = useState("");
  const [category, setCategory] = useState<string>("oil_change");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const cardWidth = width >= 720 ? "24%" : "48%";

  const submit = async () => {
    if (!token || saving) return;
    const quantity = Number(number);
    if (kind !== "maintenance" && (!number.trim() || !Number.isFinite(quantity) ||
        quantity <= 0 || (kind === "diesel" && quantity > 1000) ||
        (kind === "odometer" && (!Number.isInteger(quantity) || quantity > 10000000)))) {
      toast("Enter a valid diesel quantity or odometer reading", "error"); return;
    }
    setSaving(true);
    try {
      await apiPost("/driver/vehicle-logs", token, {
        kind,
        diesel_litres: kind === "diesel" ? quantity : null,
        odometer_km: kind === "odometer" ? quantity : null,
        maintenance_type: kind === "maintenance" ? category : null,
        notes: notes.trim() || null,
      });
      toast("Driver-reported vehicle record saved", "success");
      setNumber(""); setNotes("");
      await refetch();
    } catch (e: any) {
      toast(e?.detail || "Unable to save vehicle record", "error");
    } finally { setSaving(false); }
  };
  const total = (tile: string) => {
    if (!data) return "—";
    if (tile === "trips") return String(data.completed_trips);
    if (tile === "diesel") return data.diesel_litres == null ? "—" : data.diesel_litres.toFixed(1) + " L";
    if (tile === "odometer") return data.odometer_km == null ? "—" : data.odometer_km.toLocaleString("en-IN") + " km";
    return String(data.maintenance_count);
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 130, gap: 14, maxWidth: 980, width: "100%", alignSelf: "center" }}>
        <View style={styles.titleRow}>
          <VectorSymbol name="drop-offs" size={44} />
          <View style={{ flex: 1 }}>
            <AppText variant="title">Drop-offs</AppText>
            <AppText variant="caption">Delivery records and TM care</AppText>
          </View>
        </View>
        <View style={styles.periods}>
          {(["daily", "weekly", "monthly"] as const).map(p => (
            <Pressable key={p} testID={`dropoffs-period-${p}`} accessibilityRole="button" accessibilityState={{ selected: period === p }}
              onPress={() => setPeriod(p)} style={[styles.period, { borderColor: period === p ? colors.brand : colors.border, backgroundColor: period === p ? colors.brandSoft : colors.surfaceSecondary }]}>
              <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface, fontSize: 12 }}>{p[0].toUpperCase() + p.slice(1)}</AppText>
            </Pressable>
          ))}
        </View>
        <View style={styles.tiles}>
          {TILES.map(t => (
            <Pressable key={t.kind} testID={`dropoffs-card-${t.kind}`} accessibilityRole="button"
              onPress={() => t.kind === "trips" ? router.push("/driver/trips") : setKind(t.kind as EntryKind)}
              style={[styles.tile, { width: cardWidth as any, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <VectorSymbol name={t.symbol} size={38} />
              <AppText style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.onSurface }} numberOfLines={1}>{loading && !data ? "…" : total(t.kind)}</AppText>
              <AppText numberOfLines={2} center style={{ fontSize: 11, color: colors.onSurfaceSecondary }}>{t.label}</AppText>
            </Pressable>
          ))}
        </View>
        <AppText variant="caption">Daily, weekly and monthly totals use India calendar periods. Trips come from completed proof-of-delivery records. Fuel, odometer and maintenance are driver-reported logs, not verified invoices.</AppText>
        {error ? <Pressable onPress={() => void refetch()} accessibilityRole="button"><AppText color={colors.error}>{error} · Retry</AppText></Pressable> : null}
        <View style={[styles.form, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <AppText variant="heading">Register TM activity</AppText>
          <View style={styles.periods}>
            {(["diesel", "odometer", "maintenance"] as const).map(k => (
              <Pressable key={k} testID={`dropoffs-register-${k}`} accessibilityRole="button" accessibilityState={{ selected: kind === k }}
                onPress={() => setKind(k)} style={[styles.period, { borderColor: kind === k ? colors.brand : colors.border, backgroundColor: kind === k ? colors.brandSoft : colors.surface }]}>
                <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface, fontSize: 11 }}>
                  {k === "diesel" ? "Diesel" : k === "odometer" ? "Odometer" : "Maintenance"}
                </AppText>
              </Pressable>
            ))}
          </View>
          {kind === "maintenance" ? (
            <View style={styles.categories}>
              {MAINTENANCE.map(([key, label]) => (
                <Pressable key={key} onPress={() => setCategory(key)}
                  accessibilityRole="button" accessibilityState={{ selected: category === key }}
                  style={[styles.category, { backgroundColor: category === key ? colors.brandSoft : colors.surface, borderColor: category === key ? colors.brand : colors.border }]}>
                  <AppText style={{ fontSize: 11, color: colors.onSurface }}>{label}</AppText>
                </Pressable>
              ))}
            </View>
          ) : <>
            <AppText variant="label">{kind === "diesel" ? "Fuel added (litres)" : "Current odometer reading (km)"}</AppText>
            <TextInput testID="dropoffs-number" accessibilityLabel={kind === "diesel" ? "Diesel litres" : "Odometer km"}
              value={number} onChangeText={setNumber} keyboardType="decimal-pad" placeholder={kind === "diesel" ? "Enter litres" : "Enter km"}
              placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]} />
          </>}
          <AppText variant="label">Notes (optional)</AppText>
          <TextInput testID="dropoffs-notes" accessibilityLabel="Vehicle activity notes" value={notes}
            onChangeText={setNotes} maxLength={500} multiline placeholder="Describe the work or receipt"
            placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { minHeight: 64, borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]} />
          <Pressable testID="dropoffs-save" accessibilityRole="button" disabled={saving} onPress={() => void submit()}
            style={[styles.save, { backgroundColor: colors.brand, opacity: saving ? 0.6 : 1 }]}>
            <AppText style={{ fontFamily: fonts.bold, color: colors.onBrand }}>{saving ? "Saving…" : "Save record"}</AppText>
          </Pressable>
        </View>
        <AppText variant="heading">Recent maintenance</AppText>
        {!data?.maintenance.length ? <AppText variant="bodyMuted">No maintenance records yet.</AppText> :
          data.maintenance.map(item => (
            <View key={item.id} style={[styles.log, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <VectorSymbol name="vehicle-maintenance" size={30} />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{item.type.replace(/_/g, " ")}</AppText>
                <AppText variant="caption">{new Date(item.recorded_at).toLocaleDateString("en-IN")}{item.notes ? " · " + item.notes : ""}</AppText>
              </View>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  periods: { flexDirection: "row", gap: 6 },
  period: { minHeight: 42, flex: 1, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tiles: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 9 },
  tile: { minHeight: 128, borderRadius: 16, borderWidth: 1, justifyContent: "center", alignItems: "center", padding: 8, gap: 5 },
  form: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 10 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  category: { borderWidth: 1, borderRadius: 11, minHeight: 38, paddingHorizontal: 12, justifyContent: "center" },
  input: { minHeight: 45, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, fontSize: 14 },
  save: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 11 },
  log: { flexDirection: "row", borderWidth: 1, borderRadius: 12, minHeight: 62, alignItems: "center", gap: 10, padding: 9 },
});
