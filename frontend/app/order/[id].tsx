import React, { useEffect, useRef, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { cashfreeCheckout } from "@/src/payments/cashfree";
import { fileSource } from "@/src/api/upload";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { OrderTimeline, HistoryEntry } from "@/src/components/OrderTimeline";
import { LoadPlanner } from "@/src/components/LoadPlanner";
import { OwnerProductionBilling } from "@/src/components/OwnerProductionBilling";
import { OrderData } from "@/src/components/OrderCard";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type DeliveryProof = {
  receiver_name?: string;
  delivered_quantity?: number;
  remarks?: string;
  photo_path?: string;
  signature?: string;
  at?: string;
  load_id?: string;
  load_code?: string;
};

type DeliveryLoad = {
  id: string;
  load_code?: string;
  quantity_m3?: number;
  status?: string;
  tm_number?: string;
  driver_name?: string;
  challan_number?: string;
  gate_pass_number?: string;
  delivered_quantity?: number;
};

type Detail = {
  order: OrderData & { customer_name?: string; customer_mobile?: string; preferred_payment_mode?: string | null };
  payment_offer?: {
    status: "OFFERED" | "AWAITING_PAYMENT" | "READY_FOR_PRODUCTION" | "CANCELLED";
    mode: string;
    advance_amount: string;
    total_amount: string;
    balance_due_on?: string | null;
    expires_at: string;
    version: number;
  } | null;
  contact_person?: string;
  contact_mobile?: string;
  notes?: string;
  pod?: DeliveryProof | null;
  pods?: DeliveryProof[];
  loads?: DeliveryLoad[];
  history: HistoryEntry[];
};

const CANCELLABLE = ["DRAFT", "PENDING", "ACCEPTED", "SCHEDULED"];
// Never expose the sandbox payment control in production builds.
const PREPAID_SANDBOX_UI = process.env.EXPO_PUBLIC_RMC_PREPAID_SANDBOX_UI === "true";

export default function OrderDetail() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const isOwner = ["plant_owner", "owner"].includes(user?.role || "");
  const base = isOwner ? "/owner/orders/" : "/customer/orders/";
  const { data, loading, error, reload } = useGet<Detail>(`${base}${id}`);

  const [busy, setBusy] = useState(false);
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const whatsappPath = !isOwner && id ? `/customer/orders/${id}/dispatch-whatsapp-consent` : null;
  const { data: whatsappConsent, refetch: refreshWhatsappConsent } =
    useGet<{ opted_in: boolean; marketing_opted_in: boolean }>(whatsappPath);

  const saveWhatsappConsent = async (opted_in: boolean, marketing_opted_in: boolean) => {
    if (!token || !id) return;
    setWhatsappBusy(true);
    try {
      await apiPost(`/customer/orders/${id}/dispatch-whatsapp-consent`, token, { opted_in, marketing_opted_in });
      toast("WhatsApp preferences saved", "success");
      await refreshWhatsappConsent();
    } catch {
      toast("Could not update WhatsApp delivery preference", "error");
    } finally {
      setWhatsappBusy(false);
    }
  };
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [advanceRupees, setAdvanceRupees] = useState("");
  const [balanceDueOn, setBalanceDueOn] = useState("");
  const [prepaidBusy, setPrepaidBusy] = useState(false);
  const checkoutRef = useRef<{ version: number; key: string; gateway?: string } | null>(null);

  const act = async (path: string, body?: any, msg?: string) => {
    setBusy(true);
    try {
      await apiPost(path, token!, body);
      toast(msg || "Done", "success");
      reload();
      setShowReject(false);
      setReason("");
    } catch (e: any) {
      toast(e.detail || "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const o = data?.order;
  const offer = data?.payment_offer;

  const reconcilePrepaid = async () => {
    try {
      const result = await apiGet<{ status: string }>(`/customer/orders/${id}/prepaid/status`, token!);
      if (result.status === "VERIFIED") {
        toast("Payment independently verified. Order is confirmed.", "success");
        reload();
      } else if (result.status === "HOLD_REFUND_REVIEW") {
        toast("Payment needs reconciliation. Do not pay again; contact support.", "error");
        reload();
      } else {
        toast("Payment not yet verified. Do not make a second payment.", "info");
      }
    } catch (err: any) {
      toast(err?.detail || "Unable to verify payment. Do not retry payment until checked.", "error");
    }
  };

  useEffect(() => {
    if (!PREPAID_SANDBOX_UI || !token || isOwner || !cashfreeCheckout.available) return;
    cashfreeCheckout.setCallbacks({
      onVerify: (gatewayOrderId) => {
        if (checkoutRef.current?.gateway === gatewayOrderId) { void reconcilePrepaid(); }
      },
      onError: () => {
        toast("Checkout interrupted. Check its payment status before retrying.", "info");
      },
    });
    return () => cashfreeCheckout.removeCallbacks();
  }, [id, token, isOwner, toast, reload]);

  const startPrepaidCheckout = async () => {
    if (!offer || !token || prepaidBusy || !cashfreeCheckout.available) return;
    setPrepaidBusy(true);
    try {
      if (!checkoutRef.current || checkoutRef.current.version !== offer.version) {
        checkoutRef.current = {
          version: offer.version,
          key: `rmc-prepaid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
      }
      const result = await apiPost<{ payment_session_id: string; gateway_order_id: string; cashfree_environment: string }>(
        `/customer/orders/${id}/prepaid/checkout`, token,
        { offer_version: offer.version, idempotency_key: checkoutRef.current.key }
      );
      if (result.cashfree_environment !== "sandbox" || !result.payment_session_id) {
        throw new Error("Payment environment not approved");
      }
      checkoutRef.current.gateway = result.gateway_order_id;
      cashfreeCheckout.start(result.payment_session_id, result.gateway_order_id, false);
    } catch (err: any) {
      toast(err?.detail || err?.message || "Prepaid sandbox checkout is not enabled for this plant", "error");
    } finally {
      setPrepaidBusy(false);
    }
  };
  const approvePreferredTerms = () => {
    if (!o?.preferred_payment_mode) return;
    let advance_paise: number | null = null;
    if (o.preferred_payment_mode === "PARTIAL_ADVANCE") {
      const amount = advanceRupees.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        toast("Enter an advance amount with at most two decimal places", "error");
        return;
      }
      const [rupees, fraction = ""] = amount.split(".");
      advance_paise = Number(rupees) * 100 + Number((fraction + "00").slice(0, 2));
      if (!Number.isSafeInteger(advance_paise) || advance_paise <= 0) {
        toast("Enter a valid advance", "error");
        return;
      }
    }
    const balance_due_on = balanceDueOn.trim();
    if (balance_due_on && !/^\d{4}-\d{2}-\d{2}$/.test(balance_due_on)) {
      toast("Enter the balance due date as YYYY-MM-DD", "error");
      return;
    }
    if (o.preferred_payment_mode === "APPROVED_CREDIT" && !balance_due_on) {
      toast("Specify the approved credit repayment date", "error");
      return;
    }
    act(`/owner/orders/${id}/payment-offer`,
      { advance_paise, ...(balance_due_on ? { balance_due_on } : {}) },
      "Payment terms sent for customer approval");
  };
  const proofs = data?.pods?.length ? data.pods : (data?.pod ? [data.pod] : []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="order-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">{o?.order_number || "Order"}</AppText>
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : loading && !data ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={120} style={{ borderRadius: radius.lg }} />
          <Skeleton height={200} style={{ borderRadius: radius.lg }} />
        </View>
      ) : data && o ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
          <Card style={{ gap: spacing.md }}>
            <View style={styles.rowBetween}>
              <View>
                <AppText variant="caption">Current status</AppText>
                <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onSurface }}>
                  {o.status.replace(/_/g, " ")}
                </AppText>
              </View>
              <Badge label={o.payment_status} status={o.payment_status} />
            </View>
          </Card>

          {!isOwner ? (
            <Card style={{ gap: spacing.sm }} testID="customer-dispatch-whatsapp-consent">
              <AppText variant="heading">WhatsApp Delivery Updates</AppText>
              <AppText variant="caption">
                Receive transaction-only updates when this order's concrete is dispatched.
                This does not subscribe you to promotional WhatsApp messages.
              </AppText>
              <Button
                label={whatsappConsent?.opted_in ? "Disable WhatsApp Updates" : "Enable WhatsApp Updates"}
                variant="outline"
                loading={whatsappBusy}
                onPress={() => void saveWhatsappConsent(!whatsappConsent?.opted_in, Boolean(whatsappConsent?.marketing_opted_in))}
              />
              <AppText variant="heading">App Promotions (optional)</AppText>
              <AppText variant="caption">
                Separately agree to occasional WhatsApp information about TrackMyRMC,
                concrete ordering and pump booking. You can disable this anytime.
              </AppText>
              <Button
                label={whatsappConsent?.marketing_opted_in ? "Disable App Promotions" : "Allow App Promotions"}
                variant="outline"
                loading={whatsappBusy}
                onPress={() => void saveWhatsappConsent(Boolean(whatsappConsent?.opted_in), !whatsappConsent?.marketing_opted_in)}
              />
            </Card>
          ) : null}

          <Card style={{ gap: spacing.sm }}>
            {isOwner ? <AppText variant="label">CUSTOMER DETAILS</AppText> : null}
            {isOwner && data.order.customer_name ? <Row icon="person-outline" label="Name" value={data.order.customer_name} colors={colors} /> : null}
            {isOwner && data.order.customer_mobile ? <Row icon="call-outline" label="Contact" value={data.order.customer_mobile} colors={colors} /> : null}
            {isOwner && (data.contact_person || data.contact_mobile) ? <AppText variant="label">SITE CONTACT</AppText> : null}
            {isOwner && data.contact_person ? <Row icon="person-outline" label="Name" value={data.contact_person} colors={colors} /> : null}
            {isOwner && data.contact_mobile ? <Row icon="navigate-outline" label="Contact" value={data.contact_mobile} colors={colors} /> : null}
            <Row icon="business-outline" label="Plant" value={o.plant_name} colors={colors} />
            <Row icon="layers-outline" label="Grade" value={o.grade} colors={colors} />
            <Row icon="cube-outline" label="Quantity" value={`${o.quantity} m³`} colors={colors} />
            <Row icon="calendar-outline" label="Delivery" value={`${o.delivery_date}${o.delivery_time ? " · " + o.delivery_time : ""}`} colors={colors} />
            <Row icon="location-outline" label="Site" value={`${o.site_name}${o.site_address ? " — " + o.site_address : ""}`} colors={colors} />
            {!isOwner && data.contact_person ? <Row icon="navigate-outline" label="Site Contact" value={`${data.contact_person}${data.contact_mobile ? " · " + data.contact_mobile : ""}`} colors={colors} /> : null}
            {data.notes ? <Row icon="reader-outline" label="Notes" value={data.notes} colors={colors} /> : null}
          </Card>

          {data.loads?.length ? (
            <View style={{ gap: spacing.sm }}>
              <AppText variant="heading">Mixer Loads</AppText>
              {data.loads.map((l) => (
                <Card key={l.id} style={{ gap: 4 }}>
                  <View style={styles.rowBetween}>
                    <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{l.load_code || "Load"} · {l.quantity_m3} m³</AppText>
                    <Badge label={(l.status || "").replace(/_/g, " ")} status={l.status} />
                  </View>
                  {(l.tm_number || l.driver_name) ? <AppText variant="caption">{[l.tm_number, l.driver_name].filter(Boolean).join(" · ")}</AppText> : null}
                  {l.challan_number ? <AppText variant="caption">Challan {l.challan_number}{l.gate_pass_number ? ` · Gate ${l.gate_pass_number}` : ""}</AppText> : null}
                  {l.delivered_quantity ? <AppText variant="caption">Delivered {l.delivered_quantity} m³</AppText> : null}
                </Card>
              ))}
            </View>
          ) : null}

          <View style={{ gap: spacing.md }}>
            <AppText variant="heading">Order Timeline</AppText>
            <Card><OrderTimeline history={data.history} /></Card>
          </View>

          {proofs.length ? (
            <View style={{ gap: spacing.sm }}>
              <AppText variant="heading">Proof of Delivery</AppText>
              {proofs.map((pod, index) => {
                const code = pod.load_code || data.loads?.find((l) => l.id === pod.load_id)?.load_code;
                return (
                  <Card key={`${pod.load_id || "pod"}-${index}`} style={{ gap: spacing.md }}>
                    {code ? <AppText variant="label">{code}</AppText> : null}
                    {pod.photo_path && token ? <Image testID={`pod-photo-${index}`} source={fileSource(pod.photo_path, token)} style={styles.podPhoto} resizeMode="cover" /> : null}
                    <Row icon="person-outline" label="Received by" value={pod.receiver_name || "—"} colors={colors} />
                    <Row icon="cube-outline" label="Delivered quantity" value={`${pod.delivered_quantity ?? o.quantity} m³`} colors={colors} />
                    {pod.at ? <Row icon="time-outline" label="Delivered at" value={new Date(pod.at).toLocaleString()} colors={colors} /> : null}
                    {pod.remarks ? <Row icon="chatbubble-ellipses-outline" label="Remarks" value={pod.remarks} colors={colors} /> : null}
                    {pod.signature ? (
                      <View style={{ gap: 4 }}>
                        <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>Receiver signature</AppText>
                        <Image source={{ uri: pod.signature }} style={[styles.podSign, { borderColor: colors.border }]} resizeMode="contain" />
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          ) : null}

          {offer ? (
            <Card style={{ gap: spacing.sm }}>
              <AppText variant="heading">Plant-approved payment terms</AppText>
              <Row icon="wallet-outline" label="Payment mode" value={offer.mode.replace(/_/g, " ")} colors={colors} />
              <Row icon="cash-outline" label="Final total (INR)" value={String(offer.total_amount)} colors={colors} />
              <Row icon="card-outline" label="Advance (INR)" value={String(offer.advance_amount)} colors={colors} />
              {offer.mode !== "FULL_ADVANCE" ? (
                <>
                  <Row icon="cash-outline" label="Outstanding balance (INR)" value={(Number(offer.total_amount) - Number(offer.advance_amount)).toFixed(2)} colors={colors} />
                  <Row icon="calendar-outline" label="Balance due on" value={offer.balance_due_on || "Not specified"} colors={colors} />
                </>
              ) : null}
              <AppText variant="caption">Status: {offer.status.replace(/_/g, " ")}. No payment is taken on this screen.</AppText>
              {!isOwner && offer.status === "OFFERED" ? (
                <Button testID="customer-accept-payment-terms" label="Accept Final Terms" loading={busy}
                  onPress={() => act(`/customer/orders/${id}/accept-payment-terms`, { version: offer.version }, "Payment terms accepted")} />
              ) : null}
              {!isOwner && offer.status === "AWAITING_PAYMENT" ? (
                <View style={{ gap: spacing.sm }}>
                  <AppText variant="caption">Terms accepted. Your order remains on hold until Cashfree confirms payment. Never pay using an unofficial UPI ID or personal link.</AppText>
                  {PREPAID_SANDBOX_UI && cashfreeCheckout.available ? (
                    <View style={{ gap: spacing.sm }}>
                      <AppText variant="caption">Sandbox test mode — no real payment will be collected.</AppText>
                      <Button testID="rmc-prepaid-sandbox-checkout" label="Test Secure Prepaid Checkout" loading={prepaidBusy} onPress={startPrepaidCheckout} />
                      <Button testID="rmc-prepaid-check-status" variant="outline" label="Check Payment Status" loading={prepaidBusy} onPress={() => { void reconcilePrepaid(); }} />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          ) : !isOwner && o.preferred_payment_mode && o.status === "PENDING" ? (
            <Card><AppText variant="caption">Preferred payment: {o.preferred_payment_mode.replace(/_/g, " ")}. Awaiting plant acceptance. No payment is due now.</AppText></Card>
          ) : null}

          {isOwner && o.status === "PENDING" && ["PARTIAL_ADVANCE", "APPROVED_CREDIT"].includes(o.preferred_payment_mode || "") && !offer ? (
            <Card style={{ gap: spacing.sm }}>
              {o.preferred_payment_mode === "PARTIAL_ADVANCE" ? (
                <Input testID="owner-advance-amount" label="Plant-approved advance amount (INR)" value={advanceRupees} onChangeText={setAdvanceRupees} keyboardType="decimal-pad" placeholder="e.g. 25000.00" />
              ) : null}
              <Input testID="owner-balance-due-date"
                label={o.preferred_payment_mode === "APPROVED_CREDIT" ? "Approved credit repayment date (YYYY-MM-DD)" : "Balance due date (optional, defaults to delivery day)"}
                value={balanceDueOn} onChangeText={setBalanceDueOn} placeholder="YYYY-MM-DD" />
            </Card>
          ) : null}

          {isOwner ? (
            o.status === "PENDING" ? (
              showReject ? (
                <Card style={{ gap: spacing.md }}>
                  <AppText variant="heading">Reject order</AppText>
                  <Input testID="reject-reason" label="Reason" value={reason} onChangeText={setReason} placeholder="Why are you rejecting?" autoCapitalize="sentences" />
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Button testID="reject-cancel" label="Back" variant="secondary" onPress={() => setShowReject(false)} /></View>
                    <View style={{ flex: 1 }}><Button testID="reject-confirm" label="Confirm Reject" variant="danger" loading={busy} onPress={() => reason.trim() ? act(`/owner/orders/${id}/reject`, { reason: reason.trim() }, "Order rejected") : toast("Enter a reason", "error")} /></View>
                  </View>
                </Card>
              ) : (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}><Button testID="owner-reject" label="Reject" variant="outline" onPress={() => setShowReject(true)} /></View>
                  <View style={{ flex: 1 }}>{offer ? (
                    <AppText variant="caption">{offer.status === "OFFERED" ? "Payment offer sent. Awaiting customer acceptance." : offer.status === "AWAITING_PAYMENT" ? "Customer accepted. Waiting for verified online payment before production." : "Review the order's current commercial status before any further action."}</AppText>
                  ) : (
                    <Button testID="owner-approve" label={o.preferred_payment_mode ? "Accept & Send Terms" : "Approve"} loading={busy}
                      onPress={() => o.preferred_payment_mode ? approvePreferredTerms() : act(`/owner/orders/${id}/approve`, undefined, "Order approved")}
                      icon={<Ionicons name="checkmark-circle-outline" size={18} color={colors.onBrand} />} />
                  )}</View>
                </View>
              )
            ) : (
              <View style={{ gap: spacing.lg }}>
                <OwnerProductionBilling orderId={String(id)} status={o.status} invoiceNumber={o.invoice_number} onChanged={reload} />
                {!["DRAFT", "REJECTED", "CANCELLED", "DELIVERED"].includes(o.status) ? <LoadPlanner orderId={String(id)} resourceBase="/owner" onChanged={reload} /> : null}
              </View>
            )
          ) : (
            <View style={{ gap: spacing.sm }}>
              {["DISPATCHED", "EN_ROUTE", "AT_SITE", "UNLOADING", "POD_PENDING"].includes(o.status) ? (
                <Card style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.brandSoft, borderColor: colors.brand + "55" }}>
                  <Ionicons name="navigate" size={18} color={colors.onBrandSoft} />
                  <AppText style={{ flex: 1, fontFamily: fonts.medium, fontSize: fontSize.sm, color: colors.onBrandSoft }}>Your mixer delivery is active. Open live tracking for per-load locations.</AppText>
                </Card>
              ) : null}
              {["DISPATCHED", "EN_ROUTE", "AT_SITE", "UNLOADING", "POD_PENDING"].includes(o.status) ? <Button testID="order-track-live" label="Track Live" onPress={() => router.push(`/track/${id}` as any)} icon={<Ionicons name="navigate" size={18} color={colors.onBrand} />} /> : null}
              {o.driver_mobile ? <Button testID="order-call-driver" label="Call Driver" variant="secondary" onPress={() => Linking.openURL(`tel:${o.driver_mobile}`)} icon={<Ionicons name="call-outline" size={18} color={colors.onSurface} />} /> : null}
              {o.challan_number ? <Button testID="order-view-challan" label="View Challan" onPress={() => router.push(`/challan/${id}` as any)} icon={<Ionicons name="document-text-outline" size={18} color={colors.onBrand} />} /> : null}
              {CANCELLABLE.includes(o.status) ? <Button testID="order-cancel" label="Cancel Order" variant="outline" loading={busy} onPress={() => act(`/customer/orders/${id}/cancel`, undefined, "Order cancelled")} /> : null}
            </View>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Row({ icon, label, value, colors }: any) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={16} color={colors.brand} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>{label}</AppText>
        <AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.base, color: colors.onSurface }}>{value}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  detailRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  podPhoto: { width: "100%", height: 200, borderRadius: radius.md, backgroundColor: "#0002" },
  podSign: { width: "100%", height: 90, borderRadius: radius.sm, borderWidth: 1, backgroundColor: "#fff" },
});
