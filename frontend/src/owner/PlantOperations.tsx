import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { AppText } from "@/src/components/ui/AppText";
import { VectorSymbol, type VectorSymbolName } from "@/src/components/VectorSymbol";
import { ErrorView } from "@/src/components/StateViews";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, operationalStatus } from "@/src/theme/tokens";
import { PLANT_JOB_ROLES, roleSlotStatus, type PlantJobRole } from "@/src/domain/staffRoleCapacity";
import { STAFF_MODULE_PERMISSIONS, visibleStaffModules } from "@/src/screens/StaffModuleDirectory";
import { modulesForRole } from "@/src/navigation/moduleCatalog";
import { OwnerGlass } from "./OwnerUI";

export type WorkspacePlant = { id: string; name: string };
export const PIPELINE_STAGES = {
  to_batch: "To batch", needs_mixer: "Needs mixer", on_road: "On road", pod_due: "POD due",
  batching: "Batching", ready: "Ready to dispatch",
} as const;
export type Stage = keyof typeof PIPELINE_STAGES;
export type PipelineLoad = {
  id: string; order_id: string; order_number: string; load_number: number;
  stage: Stage; grade: string; quantity_m3: number; site_name?: string | null;
  delivery_date?: string | null;
};
export type PipelineData = { counts: Partial<Record<Stage, number>>; total: number; loads: PipelineLoad[] };

export function usePlantWorkspace(preferred?: string) {
  const [selection, select] = useState<{ source?: string; id: string }>();
  const request = useGet<{ plants: WorkspacePlant[] }>("/master/my-plants");
  const plants = request.data?.plants ?? [];
  const selected = selection && selection.source === preferred ? selection.id : undefined;
  const plant = plants.find(entry => entry.id === selected) ?? plants.find(entry => entry.id === preferred) ?? plants[0];
  return { ...request, plants, plant, setSelection: (id: string) => select({ source: preferred, id }) };
}

export function pipelinePath(plantId: string, stage?: Stage): Href {
  return { pathname: "/plant-operations/[kind]", params: { kind: "pipeline", plantId, ...(stage ? { stage } : {}) } };
}
export function recordPath(kind: string, plantId: string): Href {
  return { pathname: "/plant-operations/[kind]", params: { kind, plantId } };
}
export function businessPath(kind: string, plantId: string, material?: string): Href {
  return { pathname: "/business/[kind]", params: { kind, plantId, ...(material ? { material } : {}) } };
}

export function usePipeline(plantId?: string, options: { summary?: boolean; stage?: Stage; offset?: number } = {}) {
  const { summary = false, stage, offset = 0 } = options;
  return useGet<PipelineData>(plantId ? `/plant-operations/${encodeURIComponent(plantId)}/pipeline?summary=${summary}&offset=${offset}${stage ? `&stage=${stage}` : ""}` : null);
}

export function WorkspaceHeading({ title, action, destination }: { title: string; action?: string; destination?: Href }) {
  const router = useRouter();
  const { colors } = useTheme();
  return <View style={styles.heading}>
    <AppText accessibilityRole="header" style={styles.title}>{title}</AppText>
    {action && destination ? <Pressable style={styles.link} accessibilityRole="button" onPress={() => router.push(destination)}>
      <AppText color={colors.accentText} style={styles.label}>{action}</AppText>
    </Pressable> : null}
  </View>;
}

export function WorkspaceTile({ title, symbol, destination, detail, tone, testID, stacked = false }: {
  title: string; symbol: VectorSymbolName; destination: Href; detail?: string;
  tone?: "warning" | "critical" | "approval"; testID?: string; stacked?: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const ink = tone ? operationalStatus(tone, colors.isDark) : colors.accentText;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={detail ? title + ", " + detail : title}
    onPress={() => router.push(destination)} style={({ pressed }) => [styles.grow, { opacity: pressed ? 0.72 : 1 }]}>
    <OwnerGlass highlighted={false} style={[styles.strip, stacked && styles.stacked, tone && { backgroundColor: ink + "18", borderColor: ink + "50" }]}>
      <VectorSymbol name={symbol} size={20} color={ink} />
      <View style={stacked ? styles.stackedCopy : styles.grow}>
        <AppText center={stacked} style={styles.label}>{title}</AppText>
        {detail ? <AppText center={stacked} variant="caption">{detail}</AppText> : null}
      </View>
      {!stacked ? <VectorSymbol name="chevron-right" size={15} color={ink} /> : null}
    </OwnerGlass>
  </Pressable>;
}

export function WorkspaceAlert({ plantId, count }: { plantId: string; count?: number }) {
  if (!count) return null;
  return <WorkspaceTile testID="plant-operations-alert" title={count === 1 ? "1 load awaiting mixer assignment" : `${count} loads awaiting mixer assignment`}
    symbol="notifications" tone="warning" destination={pipelinePath(plantId, "needs_mixer")} />;
}

export function PlantSelector({ plants, plant, select }: {
  plants: WorkspacePlant[]; plant: WorkspacePlant; select: (id: string) => void;
}) {
  const { colors } = useTheme();
  if (plants.length === 1) return <AppText variant="caption">{plant.name}</AppText>;
  return <View style={styles.grid}>
    {plants.map(entry => <Pressable key={entry.id} accessibilityRole="button" accessibilityState={{ selected: plant.id === entry.id }}
      onPress={() => select(entry.id)} style={[styles.filter, { borderColor: plant.id === entry.id ? colors.brand : colors.divider,
        backgroundColor: plant.id === entry.id ? colors.brandSoft : colors.surfaceSecondary }]}>
      <AppText style={styles.label}>{entry.name}</AppText>
    </Pressable>)}
  </View>;
}

export function LoadPipeline({ plantId, plantName, request, showAlert = false, contentWidth }: {
  plantId: string; plantName?: string; request?: ReturnType<typeof usePipeline>; showAlert?: boolean; contentWidth?: number;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const summary = usePipeline(request ? undefined : plantId, { summary: true });
  const { refetch } = summary;
  const { data, error, loading, reload } = request ?? summary;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const readableWidth = (contentWidth ?? width - 32) / fontScale;
  const columns = readableWidth >= (contentWidth === undefined ? 300 : 400) ? styles.columns4
    : readableWidth >= 190 || contentWidth === undefined ? styles.columns2 : styles.full;
  const stages = [
    { stage: "to_batch", ink: colors.onSurface, background: colors.surfaceSecondary },
    { stage: "needs_mixer", ink: operationalStatus("warning", colors.isDark), background: colors.brandSoft },
    { stage: "on_road", ink: colors.accentText, background: colors.accentText + "19" },
    { stage: "pod_due", ink: colors.error, background: colors.error + "19" },
  ] as const;
  return <View testID="plant-load-pipeline" style={styles.section}>
    {showAlert ? <WorkspaceAlert plantId={plantId} count={data?.counts?.needs_mixer} /> : null}
    <WorkspaceHeading title="Load Pipeline" action="View pipeline" destination={pipelinePath(plantId)} />
    {plantName ? <AppText variant="caption">{plantName}</AppText> : null}
    {error ? <ErrorView message={error} onRetry={reload} /> : null}
    <View style={styles.grid}>
      {stages.map(({ stage, ink, background }) => <View key={stage} style={columns}>
        <Pressable testID={`load-pipeline-${stage}`} accessibilityRole="button"
          accessibilityLabel={PIPELINE_STAGES[stage] + (data ? `, ${data.counts?.[stage] ?? 0} loads` : ", count unavailable")}
          onPress={() => router.push(pipelinePath(plantId, stage))}>
          <OwnerGlass highlighted={false} style={[styles.stage, { backgroundColor: background }]}>
            <AppText color={ink} style={styles.count}>{data ? data.counts?.[stage] ?? 0 : "—"}</AppText>
            <AppText center color={ink} style={styles.label}>{PIPELINE_STAGES[stage]}</AppText>
          </OwnerGlass>
        </Pressable>
      </View>)}
    </View>
    {loading && !data ? <AppText variant="caption">Loading plant loads…</AppText> : null}
  </View>;
}

const ROLE_CARDS = {
  dispatcher: { title: "Dispatcher", symbol: "dispatch-queue" },
  operator: { title: "Batching Operator", symbol: "batching-operations" },
  supervisor: { title: "Supervisor", symbol: "incident-register" },
  accountant: { title: "Accountant", symbol: "ledger" },
  quality_engineer: { title: "Quality Engineer", symbol: "quality-register" },
  fleet_manager: { title: "Fleet Manager", symbol: "transit-mixer-fleet" },
  store_manager: { title: "Store Manager", symbol: "stock-register" },
} satisfies Record<PlantJobRole, { title: string; symbol: VectorSymbolName }>;
type Person = { id: string; name: string; role: string; active: boolean; status?: string };

const roleDestinations = (plantId: string): Record<string, Href> => ({
  "dispatcher-queue": pipelinePath(plantId),
  "dispatcher-fleet": businessPath("fleet", plantId),
  "operator-production": recordPath("batch", plantId),
  "supervisor-operations": pipelinePath(plantId),
  "supervisor-incidents": recordPath("incidents", plantId),
  "accountant-billing": "/owner/billing",
  "accountant-ledger": recordPath("ledger", plantId),
  "engineer-quality": recordPath("quality", plantId),
  "fleet-manager-fleet": businessPath("fleet", plantId),
  "fleet-manager-drivers": "/owner/drivers",
  "store-manager-stock": businessPath("inventory", plantId),
});

export function OperationsTeam({ plantId }: { plantId: string }) {
  const { colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const readableWidth = (Math.min(width, 820) - 32) / fontScale;
  const columns = readableWidth >= 490 ? styles.columns4 : readableWidth >= 200 ? styles.columns2 : styles.full;
  const [selected, setSelected] = useState<PlantJobRole>("dispatcher");
  const people = useGet<{ people: Person[] }>(`/master/plants/${encodeURIComponent(plantId)}/people`);
  const { refetch: refreshPeople } = people;
  useFocusEffect(useCallback(() => { void refreshPeople(); }, [refreshPeople]));
  const assignments = (people.data?.people ?? []).map(person => ({ ...person, user_id: person.id, is_active: person.active }));
  const person = assignments.find(entry => entry.role === selected && roleSlotStatus(assignments, selected) === "active");
  const grants = useGet<{ permissions: { key: string; view: boolean }[] }>(
    person ? `/owner/plants/${encodeURIComponent(plantId)}/staff/${encodeURIComponent(person.id)}/module-permissions` : null,
  );
  const { refetch: refreshGrants } = grants;
  useFocusEffect(useCallback(() => { void refreshGrants(); }, [refreshGrants]));
  const destinations = roleDestinations(plantId);
  const modules = visibleStaffModules(modulesForRole(selected).filter(module => Boolean(STAFF_MODULE_PERMISSIONS[module.key])),
    !grants.error ? grants.data?.permissions : undefined).flatMap(module => {
    const [prefix, kind] = typeof module.route === "string" ? module.route.slice(1).split("/") : [];
    const destination = destinations[module.key] ?? (prefix === "business" && kind ? businessPath(kind, plantId) : undefined);
    return destination ? [{ ...module, destination }] : [];
  });
  return <View testID="owner-operations-team" style={styles.section}>
    <WorkspaceHeading title="Operations Team" action="Manage staff" destination={businessPath("staff", plantId)} />
    {people.error ? <ErrorView message={people.error} onRetry={people.reload} /> : null}
    <View style={styles.grid}>
      {PLANT_JOB_ROLES.map(role => {
        const { title, symbol } = ROLE_CARDS[role];
        const occupant = assignments.find(entry => entry.role === role);
        const status = people.data ? roleSlotStatus(assignments, role) : null;
        const description = status === "available" ? "Unassigned" : status === "pending" ? "Invitation pending" :
          status === "suspended" ? "Suspended" : status === "active" ? "Assigned" : people.error ? "Unavailable" : "Loading…";
        return <View key={role} style={columns}>
          <Pressable testID={`owner-operations-role-${role}`} accessibilityRole="button"
            accessibilityState={{ selected: selected === role }} accessibilityLabel={[title, occupant?.name, description].filter(Boolean).join(", ")}
            style={styles.grow} onPress={() => setSelected(role)}>
            <OwnerGlass highlighted={false} style={[styles.person, selected === role && { backgroundColor: colors.brandSoft, borderColor: colors.brand }]}>
              <VectorSymbol name={symbol} size={23} color={colors.accentText} />
              <AppText style={styles.label}>{title}</AppText>
              {occupant ? <AppText variant="caption" numberOfLines={2}>{occupant.name}</AppText> : null}
              {status !== "active" || !occupant ? <AppText variant="caption">{description}</AppText> : null}
            </OwnerGlass>
          </Pressable>
        </View>;
      })}
    </View>
    <OwnerGlass testID="owner-operations-role-modules" highlighted={false} style={styles.box}>
      <AppText style={styles.label}>{ROLE_CARDS[selected].title} modules</AppText>
      {grants.error ? <ErrorView message={grants.error} onRetry={grants.reload} /> : null}
      {grants.loading ? <AppText variant="caption">Checking assigned modules…</AppText> : null}
      {grants.data && modules.length === 0 ? <AppText variant="caption">No modules assigned.</AppText> : null}
      {people.data && !person ? <AppText variant="caption">This role has no active employee assignment.</AppText> : null}
      {modules.map(module => <WorkspaceTile key={module.key} title={module.label}
        symbol={module.symbol ?? ROLE_CARDS[selected].symbol} destination={module.destination} />)}
    </OwnerGlass>
  </View>;
}

export const REGISTER_LABELS: Readonly<Record<string, string>> = {
  pipeline: "Load Pipeline", batch: "Batch Register", quality: "Quality Register",
  challans: "Dispatch, Challans & POD", consumption: "Material Consumption",
  maintenance: "Vehicle Maintenance", ledger: "Plant Ledger", fleet: "Track Fleet", incidents: "Incidents & SOS",
};
export function OwnerRegisters({ plantId }: { plantId: string }) {
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = (Math.min(width, 820) - 32) / fontScale >= 310;
  const items: { title: string; symbol: VectorSymbolName; href: Href }[] = [
    { title: "Raw Material Purchases", symbol: "material-receipts", href: businessPath("purchases", plantId) },
    { title: "Aggregates & Sand", symbol: "material-inventory", href: businessPath("inventory", plantId, "aggregate") },
    { title: "Cement", symbol: "cement", href: businessPath("inventory", plantId, "cement") },
    { title: "Fly Ash / GGBS", symbol: "material-inventory", href: businessPath("inventory", plantId, "fly-ash") },
    { title: "Admixtures / Silica Fume", symbol: "mix-designs", href: businessPath("inventory", plantId, "admixture") },
    { title: "Water / Ice", symbol: "material-inventory", href: businessPath("inventory", plantId, "water") },
    { title: "Stock & Consumption", symbol: "material-consumption", href: recordPath("consumption", plantId) },
    { title: "Diesel Ledger", symbol: "diesel-ledger", href: businessPath("diesel", plantId) },
    { title: "Other Expenses", symbol: "expenses", href: businessPath("expenses", plantId) },
    { title: REGISTER_LABELS.batch, symbol: "batching-operations", href: recordPath("batch", plantId) },
    { title: REGISTER_LABELS.challans, symbol: "delivery-challan", href: recordPath("challans", plantId) },
    { title: REGISTER_LABELS.quality, symbol: "quality-register", href: recordPath("quality", plantId) },
    { title: "Maintenance & Calibration", symbol: "vehicle-maintenance", href: recordPath("maintenance", plantId) },
    { title: REGISTER_LABELS.incidents, symbol: "incident-register", href: recordPath("incidents", plantId) },
  ];
  return <View testID="owner-operations-registers" style={styles.section}>
    <WorkspaceHeading title="Records & Registers" />
    <View style={styles.grid}>
      {items.map(({ title, symbol, href }) => <View key={title} style={twoColumns ? styles.columns2 : styles.full}>
        <WorkspaceTile title={title} symbol={symbol} destination={href} />
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 40 },
  title: { fontFamily: fonts.bold, fontSize: 17, flexShrink: 1 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  link: { flexShrink: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "2%", rowGap: 7 },
  columns4: { width: "23.5%", minWidth: 0 },
  columns2: { width: "49%", minWidth: 0 },
  full: { width: "100%" },
  grow: { flex: 1, minWidth: 0 },
  strip: { minHeight: 47, flex: 1, flexDirection: "row", alignItems: "center", padding: 8, gap: 6, borderRadius: 9 },
  stacked: { minHeight: 64, flexDirection: "column", justifyContent: "center", paddingHorizontal: 4 },
  stackedCopy: { minWidth: 0, alignSelf: "stretch" },
  stage: { minHeight: 67, paddingVertical: 8, paddingHorizontal: 3, justifyContent: "center", alignItems: "center" },
  count: { fontFamily: fonts.bold, fontSize: 22 },
  person: { flex: 1, minHeight: 100, padding: 7, gap: 4 },
  box: { gap: 6, padding: 10 },
  filter: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
});
