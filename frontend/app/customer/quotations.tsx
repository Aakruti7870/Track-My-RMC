import React, { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useGet } from "@/src/hooks/useApi";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type RmcLead = {
  id: string; grade: string; quantity_m3: number; site_address: string;
  delivery_date: string; status: "PENDING_SUPPLIER" | "MATCHED_RECONFIRMATION_REQUIRED" | "REQUESTED" | "CLOSED";
  canonical_request_id?: string | null; created_at: string;
};
type QuoteRequest = {
  id: string; plant_name?: string; site_name: string; site_address: string; grade: string;
  quantity: number; estimated_total?: number | null; status: "REQUESTED" | "QUOTED" | "DECLINED";
  created_at: string; quotation_number?: string; quoted_total?: number; decline_reason?: string;
};
type Quote = {
  id: string; quotation_number: string; request_id?: string; plant_id: string; customer_name: string;
  site_id?: string | null; site_name: string; site_address: string; grade: string; quantity_m3: number; rate_per_m3: number;
  transport_amount?: number; pumping_amount?: number; gst_amount?: number; total: number;
  valid_until: string; status: string; notes?: string | null; order_id?: string; order_number?: string;
};
const money = (value?: number | null) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;

export default function CustomerQuotations() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const leads = useGet<{ leads: RmcLead[] }>("/customer/rmc-rfq-leads");
  const requests = useGet<{ requests: QuoteRequest[] }>("/customer/quotation-requests");
  const quotes = useGet<{ quotations: Quote[] }>("/ops/customer/quotations");
  const refresh = () => { leads.refetch(); requests.refetch(); quotes.refetch(); };
  const confirmMatched = async (lead: RmcLead) => {
    if (!token || busy) return;
    setBusy(lead.id);
    try {
      await apiPost(`/customer/rmc-rfq-leads/${lead.id}/confirm`, token, {});
      toast("Quotation request sent to the verified plant", "success");
      refresh();
    } catch (e: any) {
      toast(e.detail || "Unable to reconfirm enquiry", "error");
    } finally { setBusy(null); }
  };
  const decide = async (quote: Quote, action: "ACCEPT" | "DECLINE") => {
    if (!token) return;
    setBusy(quote.id);
    try {
      await apiPost(`/ops/customer/quotations/${quote.id}/decision`, token, { action });
      toast(action === "ACCEPT" ? "Quotation accepted" : "Quotation declined", "success");
      refresh();
    } catch (e: any) {
      toast(e.detail || "Could not update quotation", "error");
    } finally { setBusy(null); }
  };
  const createOrder = (quote: Quote) => router.push({
    pathname: "/new-order",
    params: {
      quotationId: quote.id, siteId: quote.site_id || "", plantId: quote.plant_id, grade: quote.grade,
      quantity: String(quote.quantity_m3), siteName: quote.site_name, siteAddress: quote.site_address,
    },
  } as any);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.brand} />}>
        <View><AppText variant="title">Quotations</AppText><AppText variant="caption">Track requests and official commercial offers from plants</AppText></View>
        <Card style={{ gap: spacing.sm }}><View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={colors.brand} /><AppText variant="caption" style={{ flex: 1 }}>Comparison totals are planning estimates. Only a quotation numbered by the plant is an official commercial offer.</AppText></View></Card>

        <View style={styles.sectionTitle}>
          <AppText variant="heading">Supplier Onboarding Enquiries</AppText>
          <Badge label={String((leads.data?.leads || []).filter(l=>!l.canonical_request_id).length)} color={colors.brand}/>
        </View>
        {leads.loading && !leads.data ? <Skeleton height={100}/> : null}
        {(leads.data?.leads || []).filter(l=>!l.canonical_request_id).map(lead=>(
          <Card key={lead.id} style={{gap:spacing.sm}}>
            <AppText style={styles.name}>{lead.grade} · {lead.quantity_m3} m³</AppText>
            <AppText variant="caption">{lead.site_address} · Delivery {lead.delivery_date}</AppText>
            <AppText variant="caption">Reference: {lead.id}</AppText>
            {lead.status === "PENDING_SUPPLIER" ? <AppText variant="caption">
              TrackMyRMC admin has your enquiry. The unregistered supplier has not been contacted.
            </AppText> : null}
            {lead.status === "MATCHED_RECONFIRMATION_REQUIRED" ? <>
              <AppText variant="caption">Supplier onboarding completed. Reconfirm to share your enquiry with the approved plant.</AppText>
              <Button label="Confirm & Send to Verified Plant" loading={busy===lead.id} onPress={()=>void confirmMatched(lead)}/>
            </> : null}
            {lead.status === "CLOSED" ? <AppText variant="caption">This enquiry is closed.</AppText> : null}
          </Card>
        ))}
        <View style={styles.sectionTitle}><AppText variant="heading">My Requests</AppText><Badge label={String(requests.data?.requests.length || 0)} color={colors.brand} /></View>
        {requests.loading && !requests.data ? <Skeleton height={110} /> : null}
        {requests.data?.requests.map((item) => <Card key={item.id} style={{ gap: spacing.sm }}>
          <View style={styles.between}><View style={{ flex: 1 }}><AppText style={styles.name}>{item.plant_name || "RMC Plant"}</AppText><AppText variant="caption">{item.grade} · {item.quantity} m³ · {item.site_name}</AppText></View><Badge label={item.status} status={item.status} /></View>
          <AppText variant="caption">{item.site_address}</AppText>
          <View style={[styles.amountRow, { backgroundColor: colors.surfaceTertiary }]}><View><AppText variant="caption">Planning estimate</AppText><AppText style={styles.amount}>{money(item.estimated_total)}</AppText></View>{item.status === "QUOTED" ? <View style={{ alignItems: "flex-end" }}><AppText variant="caption">Official quote</AppText><AppText style={[styles.amount, { color: colors.brand }]}>{money(item.quoted_total)}</AppText></View> : null}</View>
          {item.status === "REQUESTED" ? <AppText variant="caption">Awaiting the plant’s commercial response.</AppText> : null}
          {item.status === "QUOTED" ? <AppText variant="caption" color={colors.success}>Issued as {item.quotation_number}. See the official offer below.</AppText> : null}
          {item.status === "DECLINED" ? <AppText variant="caption" color={colors.error}>Plant response: {item.decline_reason}</AppText> : null}
        </Card>)}
        {requests.data && requests.data.requests.length === 0 ? <Card><AppText variant="bodyMuted">No quotation requests yet. Use Estimate & Compare Plants to request one.</AppText></Card> : null}

        <View style={styles.sectionTitle}><AppText variant="heading">Official Quotations</AppText><Badge label={String(quotes.data?.quotations.length || 0)} color={colors.success} /></View>
        {quotes.loading && !quotes.data ? <><Skeleton height={140} /><Skeleton height={140} /></> : null}
        {quotes.data?.quotations.map((q) => (
          <Card key={q.id} style={{ gap: spacing.sm }}>
            <View style={styles.between}><View style={{ flex: 1 }}><View style={styles.quoteTitle}><Ionicons name="document-text-outline" size={20} color={colors.brand} /><AppText style={styles.name}>{q.quotation_number}</AppText></View><AppText variant="caption">{q.grade} · {q.quantity_m3} m³ · {q.site_name}</AppText></View><Badge label={q.status} status={q.status} /></View>
            <AppText variant="caption">{q.site_address}</AppText>
            <View style={[styles.breakdown, { borderColor: colors.border }]}>
              <Line label="Concrete rate" value={`${money(q.rate_per_m3)}/m³`} />
              <Line label="Transport" value={money(q.transport_amount)} />
              <Line label="Pumping" value={money(q.pumping_amount)} />
              <Line label="GST" value={money(q.gst_amount)} />
              <View style={[styles.between, { marginTop: spacing.xs }]}><AppText style={styles.name}>Total</AppText><AppText style={[styles.total, { color: colors.brand }]}>{money(q.total)}</AppText></View>
            </View>
            <AppText variant="caption">Valid until {q.valid_until}{q.notes ? ` · ${q.notes}` : ""}</AppText>
            {q.status === "OPEN" ? <View style={styles.actions}><View style={{ flex: 1 }}><Button label="Decline" variant="outline" onPress={() => decide(q, "DECLINE")} loading={busy === q.id} /></View><View style={{ flex: 1 }}><Button label="Accept Quote" onPress={() => decide(q, "ACCEPT")} loading={busy === q.id} /></View></View> : null}
            {q.status === "ACCEPTED" ? <Button label="Create Order from Quote" onPress={() => createOrder(q)} icon={<Ionicons name="cart-outline" size={18} color={colors.onBrand} />} /> : null}
            {q.status === "ORDER_CREATED" ? <AppText variant="caption" color={colors.success}>Converted to order {q.order_number || ""}.</AppText> : null}
            {q.status === "EXPIRED" ? <AppText variant="caption" color={colors.warning}>This quotation expired and can no longer be accepted.</AppText> : null}
          </Card>
        ))}
        {quotes.data && quotes.data.quotations.length === 0 ? <Card><AppText variant="bodyMuted">No official quotation has been issued yet.</AppText></Card> : null}
      </ScrollView>
    </View>
  );
}
function Line({ label, value }: { label: string; value: string }) {
  return <View style={styles.between}><AppText variant="caption">{label}</AppText><AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm }}>{value}</AppText></View>;
}
const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  name: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  quoteTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md },
  amount: { fontFamily: fonts.displayBold, fontSize: fontSize.lg },
  breakdown: { gap: spacing.xs, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  total: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  actions: { flexDirection: "row", gap: spacing.sm },
});
