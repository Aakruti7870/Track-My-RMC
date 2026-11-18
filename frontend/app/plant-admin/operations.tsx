import { useCallback } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { AppText } from "@/src/components/ui/AppText";
import { ErrorView } from "@/src/components/StateViews";
import { HomeScroll } from "@/src/components/HomeScroll";
import { useGet } from "@/src/hooks/useApi";
import { OwnerFrame, useOwnerBottomSpace } from "@/src/owner/OwnerUI";
import {
  LoadPipeline, PIPELINE_STAGES, WorkspaceHeading, WorkspaceTile, businessPath,
  pipelinePath, recordPath, usePipeline, usePlantWorkspace,
} from "@/src/owner/PlantOperations";
import type { StaffModuleGrant } from "@/src/screens/StaffModuleDirectory";

export default function PlantAdminOperations() {
  const router = useRouter();
  const bottom = useOwnerBottomSpace();
  const workspace = usePlantWorkspace();
  const { plant, loading, error, reload, refetch: refreshPlant } = workspace;
  const grants = useGet<{ plant_id: string; permissions: StaffModuleGrant[] }>("/staff/module-permissions");
  const { refetch: refreshGrants } = grants;
  const allowed = (key: string) => grants.data?.plant_id === plant?.id && !grants.error
    && grants.data?.permissions.some(grant => grant.key === key && grant.view) === true;
  const canDispatch = allowed("dispatch_queue");
  const canFleet = allowed("fleet_availability");
  const canIncidents = allowed("incidents");
  const loads = usePipeline(canDispatch ? plant?.id : undefined);
  const { refetch: refreshLoads } = loads;
  useFocusEffect(useCallback(() => {
    void refreshPlant();
    void refreshGrants();
    void refreshLoads();
  }, [refreshPlant, refreshGrants, refreshLoads]));
  const records = [
    { title: "Raw Material Purchases", kind: "purchases", key: "purchases", symbol: "material-receipts" },
    { title: "Material Inventory", kind: "inventory", key: "material_inventory", symbol: "material-inventory" },
    { title: "Diesel Ledger", kind: "diesel", key: "diesel_ledger", symbol: "diesel-ledger" },
    { title: "Other Expenses", kind: "expenses", key: "expenses", symbol: "expenses" },
    { title: "Mix Designs", kind: "mixes", key: "mix_designs", symbol: "mix-designs" },
    { title: "Plant Reports", kind: "reports", key: "plant_reports", symbol: "plant-reports" },
  ] as const;
  return <OwnerFrame matte>
    <HomeScroll testID="plant-admin-operations" gap={10} paddingHorizontal={16} contentContainerStyle={{ paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={loading || grants.loading} onRefresh={() => {
        void Promise.all([refreshPlant(), refreshGrants(), refreshLoads()]);
      }} />}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Plant Admin Home"
        onPress={() => router.replace("/plant-admin")} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}>
        <AppText>Back to Home</AppText>
      </Pressable>
      <AppText variant="title" accessibilityRole="header">Operations</AppText>
      {plant ? <AppText variant="caption">{plant.name}</AppText> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {grants.error ? <ErrorView message={grants.error} onRetry={grants.reload} /> : null}
      {(loading || grants.loading) && !grants.data ? <AppText variant="caption">Loading plant access…</AppText> : null}
      {!loading && !error && !plant ? <AppText variant="bodyMuted">No active plant is assigned.</AppText> : null}
      {plant ? <>
        {canDispatch ? <LoadPipeline plantId={plant.id} request={loads} showAlert /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {canFleet ? <WorkspaceTile stacked title="Track Fleet" symbol="gps-live-location" destination={recordPath("fleet", plant.id)} /> : null}
          {canDispatch ? <WorkspaceTile stacked title="Needs Attention" symbol="notifications" destination={pipelinePath(plant.id, "needs_mixer")} /> : null}
          {canIncidents ? <WorkspaceTile stacked title="SOS Alerts" symbol="incident-register" tone="critical" destination={recordPath("incidents", plant.id)} /> : null}
        </View>
        {canDispatch ? <>
          <WorkspaceHeading title="Loads to monitor" action="View all loads" destination={pipelinePath(plant.id)} />
          {loads.error ? <ErrorView message={loads.error} onRetry={loads.reload} /> : null}
          {loads.data?.loads.length === 0 ? <AppText variant="bodyMuted">No active loads to monitor.</AppText> : null}
          {loads.data?.loads.slice(0, 3).map(load => <WorkspaceTile key={load.id}
            title={`${load.order_number} · Load ${load.load_number}`}
            detail={[load.site_name, load.grade, `${load.quantity_m3} m³`, PIPELINE_STAGES[load.stage]].filter(Boolean).join(" · ")}
            symbol="transit-mixer-fleet" destination={{ pathname: "/dispatch-order/[id]", params: { id: load.order_id } }} />)}
        </> : null}
        {records.some(record => allowed(record.key)) ? <WorkspaceHeading title="Plant Records" /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: "2%", rowGap: 6 }}>
          {records.filter(record => allowed(record.key)).map(record => <View key={record.key} style={{ width: "49%" }}>
            <WorkspaceTile title={record.title} symbol={record.symbol} destination={businessPath(record.kind, plant.id)} />
          </View>)}
        </View>
        {!grants.loading && !grants.error && !canDispatch && !canFleet && !canIncidents && !records.some(record => allowed(record.key)) ?
          <AppText variant="bodyMuted">Your Plant Owner has not assigned access to these modules.</AppText> : null}
      </> : null}
    </HomeScroll>
  </OwnerFrame>;
}
