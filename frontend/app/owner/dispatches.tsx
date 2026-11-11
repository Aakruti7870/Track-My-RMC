import React, { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { ErrorView, EmptyView } from "@/src/components/StateViews";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { OwnerFrame, OwnerGlass, ui, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";
import { fonts } from "@/src/theme/tokens";

type Load = {
  id: string; order_id: string; order_number: string; load_number: number;
  plant_name: string; quantity_m3: number; status: string; grade: string;
  dispatched_at: string; mixer_number?: string | null; driver_name?: string | null;
  site_name?: string | null;
};
type DispatchResult = { window_date: string; total: number; loads: Load[]; has_more: boolean };

export default function OwnerDispatchesToday() {
  const p = useOwnerPalette();
  const bottom = useOwnerBottomSpace();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const { data, loading, error, reload, refetch } = useGet<DispatchResult>(
    `/owner/dispatches/today?limit=30&offset=${page * 30}`,
  );

  return <OwnerFrame title="Dispatches Today" subtitle="Each load actually dispatched on the database reporting date, including completed deliveries.">
    <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 4 }}>
      <AppText style={{ color: p.text, fontFamily: fonts.semibold }}>
        {data ? `${data.total} loads · ${data.window_date}` : "Loading dispatch register"}
      </AppText>
      <AppText style={{ color: p.muted, fontSize: 11 }}>
        This register uses the same date and plant scope as the dashboard Dispatches KPI.
      </AppText>
    </View>
    <FlatList
      testID="owner-dispatches-list"
      data={data?.loads ?? []}
      keyExtractor={item => item.id}
      contentContainerStyle={[ui.content, { paddingBottom: bottom, flexGrow: 1 }]}
      refreshing={loading && !!data}
      onRefresh={refetch}
      renderItem={({ item }) => <Pressable
        testID={`owner-dispatch-load-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Open order ${item.order_number} load ${item.load_number}`}
        onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.order_id } })}
      >
        <OwnerGlass style={{ padding: 12, gap: 7 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            <VectorSymbol name="delivery-challan" size={34} warmAccent />
            <View style={{ flex: 1 }}>
              <AppText style={{ color: p.text, fontFamily: fonts.semibold }}>{item.order_number} · Load {item.load_number}</AppText>
              <AppText style={{ color: p.muted, fontSize: 12 }}>{item.grade} · {item.quantity_m3} m³</AppText>
            </View>
            <Badge label={item.status.replace(/_/g, " ")} status={item.status} size="sm" />
          </View>
          <AppText style={{ color: p.muted, fontSize: 12 }}>
            {[item.plant_name, item.site_name, item.mixer_number, item.driver_name].filter(Boolean).join(" · ")}
          </AppText>
          <AppText style={{ color: p.muted, fontSize: 11 }}>
            Dispatched {new Date(item.dispatched_at).toLocaleString("en-IN")}
          </AppText>
        </OwnerGlass>
      </Pressable>}
      ListEmptyComponent={error
        ? <ErrorView message={error} onRetry={reload} />
        : loading ? <Skeleton height={105} />
        : <EmptyView icon="send-outline" title="No loads dispatched today" subtitle="Only loads with a recorded dispatch timestamp appear here." />}
      ListFooterComponent={data && (page > 0 || data.has_more)
        ? <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 }}>
            <Pressable accessibilityRole="button" disabled={!page || loading} onPress={() => setPage(v => v - 1)}>
              <AppText style={{ color: page ? p.accent : p.muted }}>Previous</AppText>
            </Pressable>
            <AppText style={{ color: p.muted }}>Page {page + 1}</AppText>
            <Pressable accessibilityRole="button" disabled={!data.has_more || loading} onPress={() => setPage(v => v + 1)}>
              <AppText style={{ color: data.has_more ? p.accent : p.muted }}>Next</AppText>
            </Pressable>
          </View>
        : null}
    />
  </OwnerFrame>;
}
