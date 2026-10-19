import React, { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useGet } from "@/src/hooks/useApi";
import type { Order } from "@/src/domain/order";
import { AppText } from "@/src/components/ui/AppText";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { OwnerFrame, OwnerGlass, ui, useOwnerBottomSpace, useOwnerPalette } from "@/src/owner/OwnerUI";
import { OwnerOrderCard } from "@/src/owner/OwnerOrderCard";

const SEGMENTS = [ { key: "all", label: "All Orders", icon: "documents-outline" }, { key: "pending", label: "Pending", icon: "document-text-outline" }, { key: "processing", label: "Processing", icon: "bus-outline" }, { key: "delivered", label: "Delivered", icon: "calendar-outline" } ] as const;
type Filters = { from: string; to: string; grade: string; plant: string; status: string };
const CLEAR: Filters = { from: "", to: "", grade: "", plant: "", status: "" };
export default function OwnerOrders() {
  const p = useOwnerPalette();
  const bottom = useOwnerBottomSpace();
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; today?: string }>();
  const active = SEGMENTS.some(segment => segment.key === params.status) ? params.status! : "all";
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<Filters>(CLEAR);
  const [draft, setDraft] = useState<Filters>(CLEAR);
  const [open, setOpen] = useState(false);
  const [validation, setValidation] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(0); }, 300); return () => clearTimeout(timer); }, [search]);
  // Route-based filters work when the tab was already mounted.
  useEffect(() => { setPage(0); setFilters(CLEAR); setSearch(""); }, [params.status, params.today]);
  const qs = new URLSearchParams({ limit: "30", offset: String(page * 30), status: filters.status || active, q: query });
  if (params.today === "1") qs.set("today", "true");
  if (filters.from) qs.set("date_from", filters.from);
  if (filters.to) qs.set("date_to", filters.to);
  if (filters.grade) qs.set("grade", filters.grade);
  if (filters.plant) qs.set("plant_id", filters.plant);
  const { data, loading, error, reload, refetch } = useGet<{ orders: (Order & { customer_name?: string })[]; has_more?: boolean }>(`/owner/orders?${qs}`);
  const { data: plants } = useGet<{ plants: { id: string; name: string }[] }>(open ? "/master/my-plants" : null);
  const filterCount = Object.values(filters).filter(Boolean).length + (params.today === "1" ? 1 : 0);
  function apply() {
    if ([draft.from, draft.to].some(value => value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))) { setValidation("Use valid dates in YYYY-MM-DD format."); return; }
    if (draft.from && draft.to && draft.from > draft.to) { setValidation("Start date must be before end date."); return; }
    setFilters(draft); setPage(0); setOpen(false); setValidation("");
  }
  const inputStyle = { color: p.text, borderWidth: 1, borderColor: p.border, backgroundColor: p.glass, padding: 12, borderRadius: 12, fontSize: 13 };
  return <OwnerFrame title="Orders" subtitle="Manage all plant orders, quotations and deliveries">
    <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 12 }}>
      <OwnerGlass style={{ flexDirection: "row", padding: 3 }}>
        {SEGMENTS.map(segment => { const selected = segment.key === active && !filters.status; return <Pressable testID={`owner-filter-${segment.key}`} key={segment.key} accessibilityRole="tab" accessibilityState={{ selected }} aria-selected={selected} onPress={() => { setFilters(previous => ({ ...previous, status: "" })); setPage(0); router.setParams({ status: segment.key }); }} style={{ flex: 1, minHeight: 61, borderRadius: 14, backgroundColor: selected ? p.accent : "transparent", alignItems: "center", justifyContent: "center", gap: 5 }}><Ionicons name={segment.icon} color={selected ? "#FFFFFF" : p.text} size={19} /><AppText style={{ fontSize: 10, color: selected ? "#FFFFFF" : p.text }}>{segment.label}</AppText></Pressable>; })}
      </OwnerGlass>
      <View style={{ flexDirection: "row", gap: 9, alignItems: "center" }}>
        <OwnerGlass style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12 }}><Ionicons name="search-outline" size={19} color={p.text} /><TextInput testID="owner-order-search" accessibilityLabel="Search by order ID, customer or site" placeholder="Search by order ID, customer or site..." placeholderTextColor={p.muted} value={search} onChangeText={setSearch} style={{ flex: 1, height: 46, fontSize: 11, color: p.text }} /></OwnerGlass>
        <Pressable accessibilityRole="button" accessibilityLabel={`Order filters${filterCount ? `, ${filterCount} active` : ""}`} onPress={() => { setDraft(filters); setOpen(true); }}><OwnerGlass style={{ width: 46, height: 46, alignItems: "center", justifyContent: "center" }}><Ionicons name="filter-outline" size={23} color={filterCount ? p.accent : p.text} /></OwnerGlass></Pressable>
      </View>
      {filterCount ? <Pressable accessibilityRole="button" onPress={() => { setFilters(CLEAR); setPage(0); router.setParams({ today: "" }); }}><AppText style={{ color: p.dark ? "#FFAD70" : "#AC4700", fontSize: 12 }}>Clear {filterCount} active filter{filterCount === 1 ? "" : "s"}</AppText></Pressable> : null}
    </View>
    <FlatList testID="owner-orders-list" data={data?.orders ?? []} keyExtractor={order => order.id} renderItem={({ item }) => <OwnerOrderCard order={item} />} initialNumToRender={8} windowSize={5} showsVerticalScrollIndicator={false} contentContainerStyle={[ui.content, { paddingBottom: bottom, flexGrow: 1 }]} refreshing={loading && !!data} onRefresh={refetch}
      ListEmptyComponent={error ? <ErrorView message={error} onRetry={reload} /> : loading ? <View style={{ gap: 12 }}>{[0, 1, 2].map(i => <Skeleton key={i} height={130} />)}</View> : <EmptyView icon="cube-outline" title={search || filterCount ? "No matching orders" : active === "pending" ? "No orders awaiting approval" : "No orders"} subtitle="Orders matching this view will appear here." />}
      ListFooterComponent={<View style={{ gap: 10 }}>{error && data ? <ErrorView message={error} onRetry={reload} /> : null}{page > 0 || data?.has_more ? <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 12 }}><Pressable accessibilityRole="button" disabled={page === 0 || loading} onPress={() => setPage(previous => previous - 1)}><AppText color={page === 0 ? p.muted : p.accent}>Previous</AppText></Pressable><AppText color={p.muted}>Page {page + 1}</AppText><Pressable accessibilityRole="button" disabled={!data?.has_more || loading} onPress={() => setPage(previous => previous + 1)}><AppText color={data?.has_more ? p.accent : p.muted}>Next</AppText></Pressable></View> : null}</View>} />
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 }}><OwnerGlass style={{ width: "100%", maxWidth: 500, alignSelf: "center", maxHeight: "90%", backgroundColor: p.canvas }}><ScrollView contentContainerStyle={{ padding: 18, gap: 12 }} keyboardShouldPersistTaps="handled">
      <AppText variant="heading">Filter orders</AppText>
      {([['from', 'Delivery date from (YYYY-MM-DD)'], ['to', 'Delivery date to (YYYY-MM-DD)'], ['grade', 'Concrete grade']] as const).map(([key, label]) => <View key={key} style={{ gap: 5 }}><AppText style={{ color: p.muted, fontSize: 12 }}>{label}</AppText><TextInput accessibilityLabel={label} value={draft[key]} onChangeText={value => setDraft(previous => ({ ...previous, [key]: value }))} style={inputStyle} /></View>)}
      <AppText style={{ color: p.muted, fontSize: 12 }}>Plant</AppText>
      {[{ id: "", name: "All my plants" }, ...(plants?.plants ?? [])].map(plant => <Pressable key={plant.id} accessibilityRole="radio" accessibilityState={{ checked: draft.plant === plant.id }} onPress={() => setDraft(previous => ({ ...previous, plant: plant.id }))} style={{ padding: 10, borderRadius: 10, backgroundColor: draft.plant === plant.id ? p.accent : p.glass }}><AppText style={{ color: draft.plant === plant.id ? "white" : p.text, fontSize: 12 }}>{plant.name}</AppText></Pressable>)}
      <AppText style={{ color: p.muted, fontSize: 12 }}>Additional status</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[["", "Use selected tab"], ["cancelled", "Cancelled / Rejected"], ["draft", "Draft"]].map(([status, label]) => <Pressable key={status} accessibilityRole="radio" accessibilityState={{ checked: draft.status === status }} onPress={() => setDraft(previous => ({ ...previous, status }))} style={{ padding: 10, borderRadius: 10, backgroundColor: draft.status === status ? p.accent : p.glass }}><AppText style={{ color: draft.status === status ? "white" : p.text, fontSize: 12 }}>{label}</AppText></Pressable>)}</View>
      {validation ? <AppText color={p.dark ? "#FF9F98" : "#B42318"}>{validation}</AppText> : null}
      <Pressable accessibilityRole="button" onPress={apply} style={{ padding: 14, backgroundColor: p.accent, borderRadius: 12 }}><AppText center color="white">Apply filters</AppText></Pressable><Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ padding: 12 }}><AppText center color={p.text}>Close</AppText></Pressable>
    </ScrollView></OwnerGlass></View></Modal>
  </OwnerFrame>;
}
