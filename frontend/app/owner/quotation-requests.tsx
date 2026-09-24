import React, { useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
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

type RequestStatus = "REQUESTED" | "QUOTED" | "DECLINED";
type OwnerQuote = { id: string; quotation_number: string; customer_name: string; grade: string; quantity_m3: number; total: number; valid_until: string; status: string; customer_response_reason?: string | null; customer_responded_at?: string; order_number?: string };
type QuoteRequest = {
  id: string; plant_id: string; plant_name?: string; customer_name?: string; customer_mobile?: string;
  site_name: string; site_address: string; grade: string; quantity: number; pump_required?: boolean;
  estimated_total?: number | null; status: RequestStatus; created_at: string; quotation_number?: string;
  quoted_total?: number; decline_reason?: string;
};
const FILTERS: { key: "ALL" | RequestStatus; label: string }[] = [
  { key: "ALL", label: "All" }, { key: "REQUESTED", label: "Pending" },
  { key: "QUOTED", label: "Quoted" }, { key: "DECLINED", label: "Declined" },
];
const rupees = (value?: number | null) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const defaultValidUntil = () => {
  const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10);
};

export default function OwnerQuotationRequests() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const plantId = user?.plant_id;
  const { data, loading, refetch } = useGet<{ requests: QuoteRequest[] }>(
    plantId ? `/ops/plants/${plantId}/quotation-requests` : null,
  );
  const quotes = useGet<{ quotations: OwnerQuote[] }>(plantId ? `/ops/plants/${plantId}/quotations` : null);
  const [filter, setFilter] = useState<"ALL" | RequestStatus>("REQUESTED");
  const [quoteFilter, setQuoteFilter] = useState("ALL");
  const [active, setActive] = useState<QuoteRequest | null>(null);
  const [mode, setMode] = useState<"QUOTE" | "DECLINE">("QUOTE");
  const [rate, setRate] = useState("");
  const [gst, setGst] = useState("18");
  const [transport, setTransport] = useState("0");
  const [pumping, setPumping] = useState("0");
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (data?.requests || []).filter((v) => filter === "ALL" || v.status === filter), [data, filter]);
  const quoteRows = useMemo(() => (quotes.data?.quotations || []).filter((v) => quoteFilter === "ALL" || v.status === quoteFilter), [quotes.data, quoteFilter]);
  const total = active ? Number(active.quantity) * Number(rate || 0) + Number(transport || 0) + Number(pumping || 0) : 0;
  const grandTotal = total * (1 + Number(gst || 0) / 100);

  const openResponse = (item: QuoteRequest, nextMode: "QUOTE" | "DECLINE") => {
    setActive(item); setMode(nextMode); setRate(""); setGst("18"); setTransport("0");
    setPumping(item.pump_required ? "0" : "0"); setValidUntil(defaultValidUntil()); setNotes(""); setReason("");
  };

  const submit = async () => {
    if (!token || !plantId || !active) return;
    if (mode === "QUOTE" && (!(Number(rate) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil))) {
      return toast("Enter a valid rate and validity date", "error");
    }
    if (mode === "DECLINE" && !reason.trim()) return toast("Decline reason is required", "error");
    setBusy(true);
    try {
      await apiPost(`/ops/plants/${plantId}/quotation-requests/${active.id}/respond`, token, mode === "QUOTE" ? {
        action: "SEND", rate_per_m3: Number(rate), gst_rate: Number(gst || 0),
        transport_amount: Number(transport || 0), pumping_amount: Number(pumping || 0),
        valid_until: validUntil, notes: notes.trim() || null,
      } : { action: "DECLINE", decline_reason: reason.trim() });
      toast(mode === "QUOTE" ? "Official quotation sent" : "Request declined", "success");
      setActive(null); refetch(); quotes.refetch();
    } catch (e: any) {
      toast(e.detail || "Could not update request", "error");
    } finally { setBusy(false); }
  };

  if (!plantId) return <View style={[styles.center, { backgroundColor: colors.surface }]}><AppText variant="heading">No plant assigned</AppText><AppText variant="caption">This account needs a plant before quotation requests can be managed.</AppText></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { refetch(); quotes.refetch(); }} tintColor={colors.brand} />}>
        <View><AppText variant="title">Quotation Requests</AppText><AppText variant="caption">Review customer requirements and issue official plant quotations</AppText></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {FILTERS.map((item) => <Chip key={item.key} label={item.label} selected={filter === item.key} onPress={() => setFilter(item.key)} />)}
        </ScrollView>
        <Card style={{ gap: spacing.sm }}><View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={19} color={colors.success} /><AppText variant="caption" style={{ flex: 1 }}>Only an Owner, Admin or Accountant with access to this plant can respond. Every response is audited.</AppText></View></Card>
        {loading && !data ? <><Skeleton height={150} /><Skeleton height={150} /></> : null}
        {rows.map((item) => <Card key={item.id} style={{ gap: spacing.md }}>
          <View style={styles.between}><View style={{ flex: 1 }}><AppText variant="heading">{item.customer_name || "Customer"}</AppText><AppText variant="caption">{item.customer_mobile || "Mobile not provided"} · {new Date(item.created_at).toLocaleDateString("en-IN")}</AppText></View><Badge label={item.status} status={item.status} /></View>
          <View style={[styles.requirement, { backgroundColor: colors.surfaceTertiary }]}><View><AppText variant="caption">Requirement</AppText><AppText style={styles.requirementText}>{item.grade} · {item.quantity} m³</AppText></View><View style={{ alignItems: "flex-end" }}><AppText variant="caption">Customer estimate</AppText><AppText style={{ fontFamily: fonts.semibold }}>{rupees(item.estimated_total)}</AppText></View></View>
          <View><AppText style={{ fontFamily: fonts.semibold }}>{item.site_name}</AppText><AppText variant="caption">{item.site_address}</AppText></View>
          {item.pump_required ? <Badge label="Pump required" color={colors.brand} /> : null}
          {item.status === "QUOTED" ? <AppText variant="caption">Sent {item.quotation_number} · {rupees(item.quoted_total)}</AppText> : null}
          {item.status === "DECLINED" ? <AppText variant="caption" color={colors.error}>Reason: {item.decline_reason}</AppText> : null}
          {item.status === "REQUESTED" ? <View style={styles.actions}><View style={{ flex: 1 }}><Button label="Decline" variant="outline" onPress={() => openResponse(item, "DECLINE")} /></View><View style={{ flex: 1 }}><Button label="Prepare Quote" onPress={() => openResponse(item, "QUOTE")} /></View></View> : null}
        </Card>)}
        {data && rows.length === 0 ? <Card style={styles.empty}><Ionicons name="document-text-outline" size={30} color={colors.onSurfaceTertiary} /><AppText variant="heading">No requests in this filter</AppText></Card> : null}

        <View style={styles.between}><AppText variant="heading">Customer Decisions</AppText><Badge label={String(quotes.data?.quotations.length || 0)} color={colors.success} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {["ALL", "OPEN", "ACCEPTED", "DECLINED", "EXPIRED", "ORDER_CREATED"].map((item) => <Chip key={item} label={item === "ORDER_CREATED" ? "Ordered" : item.charAt(0) + item.slice(1).toLowerCase()} selected={quoteFilter === item} onPress={() => setQuoteFilter(item)} />)}
        </ScrollView>
        {quotes.loading && !quotes.data ? <Skeleton height={120} /> : null}
        {quoteRows.map((quote) => <Card key={quote.id} style={{ gap: spacing.sm }}>
          <View style={styles.between}><View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold }}>{quote.quotation_number}</AppText><AppText variant="caption">{quote.customer_name} · {quote.grade} · {quote.quantity_m3} m³</AppText></View><Badge label={quote.status} status={quote.status} /></View>
          <View style={[styles.requirement, { backgroundColor: colors.surfaceTertiary }]}><AppText variant="caption">Official total</AppText><AppText style={styles.requirementText}>{rupees(quote.total)}</AppText></View>
          <AppText variant="caption">Valid until {quote.valid_until}</AppText>
          {quote.customer_response_reason ? <AppText variant="caption">Customer note: {quote.customer_response_reason}</AppText> : null}
          {quote.customer_responded_at ? <AppText variant="caption">Responded {new Date(quote.customer_responded_at).toLocaleString("en-IN")}</AppText> : null}
          {quote.status === "ORDER_CREATED" ? <AppText variant="caption" color={colors.success}>Converted to order {quote.order_number || ""}</AppText> : null}
          {quote.status === "EXPIRED" ? <AppText variant="caption" color={colors.warning}>Expired without customer acceptance.</AppText> : null}
        </Card>)}
      </ScrollView>

      <Modal visible={!!active} transparent animationType="slide" onRequestClose={() => setActive(null)}>
        <View style={styles.backdrop}><View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
            <View style={styles.between}><AppText variant="heading">{mode === "QUOTE" ? "Prepare Official Quote" : "Decline Request"}</AppText><Pressable onPress={() => setActive(null)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></View>
            <AppText variant="caption">{active?.grade} · {active?.quantity} m³ · {active?.site_name}</AppText>
            {mode === "QUOTE" ? <>
              <Input label="Rate per m³" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
              <Input label="Transport amount" value={transport} onChangeText={setTransport} keyboardType="decimal-pad" />
              <Input label="Pumping amount" value={pumping} onChangeText={setPumping} keyboardType="decimal-pad" />
              <Input label="GST %" value={gst} onChangeText={setGst} keyboardType="decimal-pad" />
              <Input label="Valid until (YYYY-MM-DD)" value={validUntil} onChangeText={setValidUntil} />
              <Input label="Commercial notes (optional)" value={notes} onChangeText={setNotes} />
              <View style={[styles.totalBox, { backgroundColor: colors.brandSoft }]}><AppText variant="caption">Official quotation total</AppText><AppText style={[styles.total, { color: colors.brand }]}>{rupees(grandTotal)}</AppText></View>
            </> : <Input label="Mandatory reason" value={reason} onChangeText={setReason} placeholder="Explain why this plant cannot quote" />}
            <Button label={mode === "QUOTE" ? "Send Official Quotation" : "Confirm Decline"} variant={mode === "QUOTE" ? "primary" : "danger"} onPress={submit} loading={busy} />
            <Button label="Cancel" variant="ghost" onPress={() => setActive(null)} />
          </ScrollView>
        </View></View>
      </Modal>
    </View>
  );
}
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}><AppText style={{ fontFamily: fonts.semibold, color: selected ? colors.onBrand : colors.onSurface }}>{label}</AppText></Pressable>;
}
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  chip: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  requirement: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  requirementText: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  actions: { flexDirection: "row", gap: spacing.sm },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"] },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.48)" },
  sheet: { maxHeight: "90%", borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
  totalBox: { padding: spacing.md, borderRadius: radius.md },
  total: { fontFamily: fonts.displayBold, fontSize: 28 },
});
