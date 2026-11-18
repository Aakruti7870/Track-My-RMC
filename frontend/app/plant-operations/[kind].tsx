import { useCallback, useState } from "react";
import { Linking, Pressable, RefreshControl, View } from "react-native";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { ErrorView } from "@/src/components/StateViews";
import { HomeScroll } from "@/src/components/HomeScroll";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { useGet } from "@/src/hooks/useApi";
import { OwnerFrame, OwnerGlass } from "@/src/owner/OwnerUI";
import {
  PIPELINE_STAGES, REGISTER_LABELS, WorkspaceTile, businessPath, usePipeline, type Stage,
} from "@/src/owner/PlantOperations";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";

type RegisterRow = {
  id: string; order_id?: string; challan_id?: string; title: string; detail: string; recorded_at?: string | null;
  latitude?: number | null; longitude?: number | null;
};

export default function PlantOperationsRecords() {
  const { user, hydrating, token } = useAuth();
  const { kind, plantId, stage } = useLocalSearchParams<{ kind?: string; plantId?: string; stage?: string }>();
  if (hydrating) return null;
  if (!user || !token) return <Redirect href="/login" />;
  const admin = user.role === "admin";
  if (!admin && user.role !== "owner" && user.role !== "plant_owner") return <Redirect href="/role-home" />;
  if (!plantId || !kind || !Object.hasOwn(REGISTER_LABELS, kind)) {
    return <Redirect href={admin ? "/plant-admin/operations" : "/owner/operations"} />;
  }
  return <PlantRecords key={`${plantId}/${kind}/${stage}`} plantId={plantId} kind={kind} admin={admin} initialStage={stage} />;
}

function PlantRecords({ kind, plantId, admin, initialStage }: { kind: string; plantId: string; admin: boolean; initialStage?: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [stage, setStage] = useState<Stage | undefined>(
    initialStage && Object.hasOwn(PIPELINE_STAGES, initialStage) ? initialStage as Stage : undefined,
  );
  const pipeline = kind === "pipeline";
  const loads = usePipeline(pipeline ? plantId : undefined, { stage, offset });
  const register = useGet<{ rows: RegisterRow[]; has_more: boolean }>(
    !pipeline ? `/plant-operations/${encodeURIComponent(plantId)}/registers/${kind}?offset=${offset}` : null,
  );
  const current = pipeline ? loads : register;
  const { refetch } = current;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const more = pipeline ? (loads.data?.total ?? 0) > offset + 30 : register.data?.has_more === true;
  const noRows = pipeline ? !loads.data?.loads.length : !register.data?.rows.length;
  return <OwnerFrame matte>
    <Pressable style={{ paddingHorizontal: 16, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}
      accessibilityRole="button" accessibilityLabel="Back to Operations"
      onPress={() => router.canGoBack() ? router.back() : router.replace(admin ? "/plant-admin/operations" : "/owner/operations")}>
      <VectorSymbol name="chevron-left" size={18} color={colors.accentText} />
      <AppText>Back</AppText>
    </Pressable>
    <HomeScroll paddingHorizontal={16} gap={8} contentContainerStyle={{ paddingBottom: 46 }}
      refreshControl={<RefreshControl refreshing={current.loading} onRefresh={current.reload} />}>
      <AppText variant="title" accessibilityRole="header">{REGISTER_LABELS[kind]}</AppText>
      {pipeline ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {([undefined, ...Object.keys(PIPELINE_STAGES)] as (Stage | undefined)[]).map(item =>
          <Pressable key={item ?? "all"} accessibilityRole="button" accessibilityState={{ selected: stage === item }}
            onPress={() => { setOffset(0); setStage(item); }}
            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 9, borderWidth: 1,
              borderColor: item === stage ? colors.brand : colors.divider, backgroundColor: item === stage ? colors.brandSoft : colors.surfaceSecondary }}>
            <AppText variant="caption">{item ? PIPELINE_STAGES[item] : "All stages"}</AppText>
          </Pressable>)}
      </View> : null}
      {kind === "consumption" ? <WorkspaceTile title="Current stock" symbol="stock-register" destination={businessPath("inventory", plantId)} /> : null}
      {kind === "maintenance" ? <WorkspaceTile title="Plant calibration details" symbol="plant-profile"
        destination={{ pathname: "/plant-profile", params: { assigned: "1", plantId } }} /> : null}
      {kind === "incidents" && !admin ? <WorkspaceTile title="Manage SOS alerts" symbol="incident-register" destination="/owner/incidents" /> : null}
      {current.error ? <ErrorView message={current.error} onRetry={current.reload} /> : null}
      {current.loading && !current.data ? <AppText variant="caption">Loading records…</AppText> : null}
      {!current.loading && !current.error && noRows ? <AppText variant="bodyMuted">No records in this view.</AppText> : null}
      {loads.data?.loads.map(load => <WorkspaceTile key={load.id} testID={`pipeline-load-${load.id}`}
        title={`${load.order_number} · Load ${load.load_number}`}
        detail={[PIPELINE_STAGES[load.stage], load.site_name, load.grade, load.quantity_m3 + " m³"].filter(Boolean).join(" · ")}
        symbol={load.stage === "pod_due" ? "delivery-challan" : "transit-mixer-fleet"}
        destination={orderPath(load.order_id, admin)} />)}
      {register.data?.rows.map(row => {
        const lastPing = kind === "fleet" && row.recorded_at
          ? "Last GPS update " + new Date(row.recorded_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          : formattedDate(row.recorded_at);
        const detail = [row.detail, lastPing].filter(Boolean).join(" · ");
        const { latitude, longitude } = row;
        const coordinates = typeof latitude === "number" && Math.abs(latitude) <= 90
          && typeof longitude === "number" && Math.abs(longitude) <= 180 ? `${latitude},${longitude}` : null;
        if (row.challan_id && row.order_id) return <WorkspaceTile key={row.id} title={row.title} detail={detail} symbol="delivery-challan"
          destination={{ pathname: "/challan/[id]", params: { id: row.order_id, loadId: row.challan_id } }} />;
        return <OwnerGlass key={row.id} highlighted={false} style={{ padding: 10, gap: 5 }}>
          <AppText>{row.title}</AppText>
          <AppText variant="caption">{detail}</AppText>
          {kind === "fleet" ? coordinates
            ? <Button label="Open last location" variant="outline" onPress={() => {
              const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
              void Linking.openURL(url).catch(() => toast("Could not open the map.", "error"));
            }} />
            : <AppText variant="caption">No GPS location reported.</AppText> : null}
          {row.order_id && !admin ? <WorkspaceTile title="View order" symbol="plant-orders" destination={orderPath(row.order_id, false)} /> : null}
        </OwnerGlass>;
      })}
      {offset > 0 || more ? <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Button label="Previous" variant="outline" disabled={offset === 0 || current.loading} onPress={() => setOffset(offset - 30)} />
        <Button label="Next" variant="outline" disabled={!more || current.loading} onPress={() => setOffset(offset + 30)} />
      </View> : null}
    </HomeScroll>
  </OwnerFrame>;
}

function orderPath(id: string, admin: boolean): Href {
  return admin ? { pathname: "/dispatch-order/[id]", params: { id } } : { pathname: "/order/[id]", params: { id } };
}

function formattedDate(date?: string | null) {
  return date ? new Date(date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : undefined;
}
