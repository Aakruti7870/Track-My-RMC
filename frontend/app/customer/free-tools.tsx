import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Shape = "SLAB" | "FOOTING" | "BEAM" | "COLUMN" | "CIRCULAR";
type Tool = "CALCULATE" | "GRADES" | "CHECKLIST" | "SAVED";
type Saved = { id: string; name: string; shape: Shape; quantity: number; grade?: string; wastage: number; created_at: string; checklist: Record<string, boolean> };
type Grade = { name: string; strength: number; group: "Ordinary" | "Standard" | "High-strength"; summary: string; exposure?: string; structural: boolean };

const STORAGE_KEY = "trackmyrmc:free-tools:v1";
const GRADES: Grade[] = [
  { name: "M10", strength: 10, group: "Ordinary", structural: false, summary: "Lean/plain concrete, levelling and blinding below foundations where approved drawings permit." },
  { name: "M15", strength: 15, group: "Ordinary", structural: false, exposure: "Minimum PCC grade for mild and moderate exposure.", summary: "Plain concrete, non-structural bases, pathways and similar PCC work where specified." },
  { name: "M20", strength: 20, group: "Ordinary", structural: true, exposure: "Minimum RCC grade for mild exposure.", summary: "Basic designed RCC work where structural drawings and durability conditions permit." },
  { name: "M25", strength: 25, group: "Standard", structural: true, exposure: "Minimum RCC grade for moderate exposure.", summary: "Commonly specified for designed slabs, beams, columns and foundations." },
  { name: "M30", strength: 30, group: "Standard", structural: true, exposure: "Minimum RCC grade for severe exposure.", summary: "Higher-load structural and durability-controlled RCC work." },
  { name: "M35", strength: 35, group: "Standard", structural: true, exposure: "Minimum RCC grade for very severe exposure.", summary: "Demanding structural members and infrastructure with controlled production." },
  { name: "M40", strength: 40, group: "Standard", structural: true, exposure: "Minimum RCC grade for extreme exposure.", summary: "Heavily loaded or durability-critical structural work where designed." },
  { name: "M45", strength: 45, group: "Standard", structural: true, summary: "Engineer-designed high-load members, foundations, piles and infrastructure where specified." },
  { name: "M50", strength: 50, group: "Standard", structural: true, summary: "High-load columns, transfer members, specialised foundations and infrastructure designs." },
  { name: "M55", strength: 55, group: "Standard", structural: true, summary: "Specialised high-load and durability-critical designs with strict quality control." },
  { name: "M60", strength: 60, group: "High-strength", structural: true, summary: "Specialist high-rise, major infrastructure and heavily loaded structural elements." },
];
const CHECKS = [
  ["road", "Approach road is suitable for a transit mixer"],
  ["entry", "Site entrance and turning space are clear"],
  ["pump", "Concrete pump requirement is confirmed"],
  ["labour", "Labour, vibrator and finishing tools are ready"],
  ["pour", "Formwork, reinforcement and pour area are ready"],
  ["contact", "Site contact person will be available"],
] as const;
const SHAPES: { key: Shape; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "SLAB", label: "Slab", icon: "grid-outline" },
  { key: "FOOTING", label: "Footing", icon: "layers-outline" },
  { key: "BEAM", label: "Beam", icon: "remove-outline" },
  { key: "COLUMN", label: "Column", icon: "reorder-two-outline" },
  { key: "CIRCULAR", label: "Circular", icon: "ellipse-outline" },
];

const n = (value: string) => Math.max(0, Number(value) || 0);
const round = (value: number) => Math.round(value * 100) / 100;

export default function FreeRmcTools() {
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [tool, setTool] = useState<Tool>("CALCULATE");
  const [shape, setShape] = useState<Shape>("SLAB");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [depth, setDepth] = useState("");
  const [diameter, setDiameter] = useState("");
  const [count, setCount] = useState("1");
  const [wastage, setWastage] = useState(3);
  const [selectedGrade, setSelectedGrade] = useState<string>();
  const [expandedGrade, setExpandedGrade] = useState<string>();
  const [saveName, setSaveName] = useState("");
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Saved[]>([]);

  useEffect(() => { AsyncStorage.getItem(STORAGE_KEY).then((raw) => { if (raw) setSaved(JSON.parse(raw)); }).catch(() => {}); }, []);
  const persist = async (next: Saved[]) => { setSaved(next); await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); };

  const base = useMemo(() => shape === "CIRCULAR"
    ? Math.PI * Math.pow(n(diameter) / 2, 2) * n(depth) * Math.max(1, n(count))
    : n(length) * n(width) * n(depth) * Math.max(1, n(count)), [count, depth, diameter, length, shape, width]);
  const quantity = round(base * (1 + wastage / 100));
  const ready = CHECKS.filter(([key]) => checklist[key]).length;

  const save = async () => {
    if (!quantity) return toast("Enter valid measurements first", "error");
    if (!saveName.trim()) return toast("Enter a site or calculation name", "error");
    const item: Saved = { id: String(Date.now()), name: saveName.trim(), shape, quantity, grade: selectedGrade, wastage, created_at: new Date().toISOString(), checklist };
    await persist([item, ...saved].slice(0, 50));
    setSaveName("");
    toast("Calculation saved on this device", "success");
  };
  const openOrder = (item?: Saved) => {
    const q = item?.quantity ?? quantity;
    const grade = item?.grade ?? selectedGrade;
    if (!q) return toast("Calculate a valid quantity first", "error");
    router.push({ pathname: "/new-order", params: { quantity: String(q), grade: grade || "" } } as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.divider }]}>
        <Pressable testID="free-tools-back" onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.onSurface} /></Pressable>
        <View style={{ flex: 1 }}><AppText style={[styles.headerTitle, { color: colors.onSurface }]}>Free RMC Tools</AppText><AppText style={[styles.headerSub, { color: colors.onSurfaceSecondary }]}>Plan your concrete requirement safely</AppText></View>
        <Ionicons name="calculator-outline" size={26} color={colors.brand} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 90, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {([["CALCULATE", "Calculate"], ["GRADES", "Grade Guide"], ["CHECKLIST", "Site Checklist"], ["SAVED", "Saved"]] as [Tool, string][]).map(([key, label]) =>
            <Chip key={key} label={label} selected={tool === key} onPress={() => setTool(key)} />)}
        </ScrollView>

        {tool === "CALCULATE" ? <>
          <Card style={{ gap: spacing.md }}>
            <AppText variant="heading">Concrete Quantity Calculator</AppText>
            <AppText variant="caption">Enter all measurements in metres. The result is an estimate and must be checked against drawings and actual site dimensions.</AppText>
            <View style={styles.shapeGrid}>{SHAPES.map((item) => {
              const selected = shape === item.key;
              return <Pressable key={item.key} onPress={() => setShape(item.key)} style={[styles.shape, { backgroundColor: selected ? colors.brandSoft : colors.surfaceTertiary, borderColor: selected ? colors.brand : colors.border }]}>
                <Ionicons name={item.icon} size={20} color={selected ? colors.brand : colors.onSurfaceSecondary} /><AppText style={{ fontFamily: fonts.semibold, fontSize: 12 }}>{item.label}</AppText>
              </Pressable>;
            })}</View>
            {shape === "CIRCULAR" ? <Input label="Diameter (m)" value={diameter} onChangeText={setDiameter} keyboardType="decimal-pad" /> :
              <><Input label="Length (m)" value={length} onChangeText={setLength} keyboardType="decimal-pad" /><Input label="Width (m)" value={width} onChangeText={setWidth} keyboardType="decimal-pad" /></>}
            <Input label={shape === "CIRCULAR" ? "Height / depth (m)" : "Depth / thickness (m)"} value={depth} onChangeText={setDepth} keyboardType="decimal-pad" />
            <Input label="Number of identical members" value={count} onChangeText={setCount} keyboardType="number-pad" />
            <View style={{ gap: spacing.sm }}><AppText variant="label">Wastage allowance</AppText><View style={styles.row}>{[0, 3, 5].map((v) => <Chip key={v} label={`${v}%`} selected={wastage === v} onPress={() => setWastage(v)} />)}</View></View>
          </Card>
          <Card style={{ gap: spacing.md }}>
            <AppText variant="caption">Estimated order quantity</AppText><AppText style={[styles.result, { color: colors.brand }]}>{quantity.toFixed(2)} m³</AppText>
            <AppText variant="caption">Base volume {round(base).toFixed(2)} m³ + {wastage}% allowance. Confirm allowance with your engineer and plant.</AppText>
            <Input label="Site / calculation name" value={saveName} onChangeText={setSaveName} placeholder="e.g. A Wing slab" />
            <View style={styles.row}><View style={{ flex: 1 }}><Button label="Save" variant="outline" onPress={save} /></View><View style={{ flex: 1 }}><Button label="Use in Order" onPress={() => openOrder()} /></View></View>
          </Card>
        </> : tool === "GRADES" ? <>
          <Card style={{ gap: spacing.sm }}>
            <View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={colors.brand} /><AppText variant="caption" style={{ flex: 1 }}>IS 456 grade strength means characteristic compressive strength at 28 days. Final selection must follow approved structural drawings.</AppText></View>
          </Card>
          {GRADES.map((grade) => {
            const expanded = expandedGrade === grade.name;
            return <Pressable key={grade.name} onPress={() => setExpandedGrade(expanded ? undefined : grade.name)}>
              <Card style={{ gap: spacing.sm, borderColor: selectedGrade === grade.name ? colors.brand : colors.border }}>
                <View style={styles.between}><View><AppText variant="heading">{grade.name}</AppText><AppText variant="caption">{grade.strength} N/mm² at 28 days · {grade.group}</AppText></View><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceTertiary} /></View>
                {expanded ? <>
                  <AppText>{grade.summary}</AppText>
                  {grade.exposure ? <View style={[styles.codeBox, { backgroundColor: colors.surfaceTertiary }]}><AppText variant="caption">{grade.exposure}</AppText></View> : null}
                  <AppText variant="caption">Common applications are informative only—not automatic structural approval.</AppText>
                  <Button label={selectedGrade === grade.name ? `${grade.name} selected` : `Use ${grade.name} in Estimate`} variant={selectedGrade === grade.name ? "outline" : "primary"} onPress={() => setSelectedGrade(grade.name)} />
                </> : null}
              </Card>
            </Pressable>;
          })}
          <Card style={{ gap: spacing.sm }}><AppText variant="label">Code reference</AppText><AppText variant="caption">IS 456:2000, reaffirmed 2021, including applicable amendments. M45 Pile is a project-specific mix variant, not a separate IS grade.</AppText></Card>
        </> : tool === "CHECKLIST" ? <>
          <Card style={{ gap: spacing.md }}><View style={styles.between}><AppText variant="heading">Site Readiness</AppText><Badge label={`${ready}/${CHECKS.length} ready`} status={ready === CHECKS.length ? "DELIVERED" : "PENDING"} /></View>
            {CHECKS.map(([key, label]) => <Pressable key={key} onPress={() => setChecklist((v) => ({ ...v, [key]: !v[key] }))} style={[styles.checkRow, { borderColor: colors.border }]}>
              <Ionicons name={checklist[key] ? "checkbox" : "square-outline"} size={22} color={checklist[key] ? colors.success : colors.onSurfaceTertiary} /><AppText style={{ flex: 1 }}>{label}</AppText>
            </Pressable>)}
          </Card>
          <Card><AppText variant="caption">This checklist assists planning only. Site safety, formwork, reinforcement, access and pour approval remain the responsibility of authorised site professionals.</AppText></Card>
        </> : saved.length ? saved.map((item) => <Card key={item.id} style={{ gap: spacing.md }}>
          <View style={styles.between}><View><AppText variant="heading">{item.name}</AppText><AppText variant="caption">{item.shape.toLowerCase()} · {new Date(item.created_at).toLocaleDateString("en-IN")}</AppText></View><AppText style={[styles.savedQty, { color: colors.brand }]}>{item.quantity.toFixed(2)} m³</AppText></View>
          <View style={styles.row}>{item.grade ? <Badge label={item.grade} color={colors.brand} /> : null}<Badge label={`${item.wastage}% allowance`} /></View>
          <View style={styles.row}><View style={{ flex: 1 }}><Button label="Delete" variant="outline" onPress={() => persist(saved.filter((v) => v.id !== item.id))} /></View><View style={{ flex: 1 }}><Button label="Use in Order" onPress={() => openOrder(item)} /></View></View>
        </Card>) : <Card style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"] }}><Ionicons name="bookmark-outline" size={32} color={colors.onSurfaceTertiary} /><AppText variant="heading">No saved calculations</AppText><AppText variant="caption">Your saved quantities will appear here on this device.</AppText></Card>}
      </ScrollView>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}><AppText style={{ fontFamily: fonts.semibold, color: selected ? colors.onBrand : colors.onSurface }}>{label}</AppText></Pressable>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl }, headerSub: { fontSize: 12 },
  chip: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  shapeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, shape: { minWidth: "30%", flexGrow: 1, minHeight: 62, alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderRadius: radius.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  result: { fontFamily: fonts.displayBold, fontSize: 36 }, savedQty: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, codeBox: { padding: spacing.md, borderRadius: radius.md },
  checkRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
});
