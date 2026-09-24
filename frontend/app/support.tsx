import React, { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import type { OrderData } from "@/src/components/OrderCard";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";
import { supportActionRoute, type SupportAction } from "@/src/support/routes";
import { SCRIPTED_SUPPORT, type ScriptedSupportChoice, type SupportCategory } from "@/src/support/scriptedSupport";

type Category = SupportCategory;
type Reply = { category: Category; guidance: string; action: SupportAction; order?: OrderData; case_id?: string; case_number?: string; case_status?: string };
type CaseMessage = { message: string; author: string; created_at?: string };
type SupportCase = { id: string; case_number: string; category: Category; status: string; created_at: string; order_id?: string; latest_note?: string; messages?: CaseMessage[] };

const ISSUES: { category: Category; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { category: "LOGIN", label: "Login Issue", icon: "log-in-outline" }, { category: "KYC", label: "KYC Issue", icon: "id-card-outline" },
  { category: "ORDER", label: "Order Issue", icon: "cube-outline" }, { category: "TRACKING", label: "Track Delivery", icon: "navigate-outline" },
  { category: "PAYMENT", label: "Payment Issue", icon: "card-outline" }, { category: "ACCOUNT_DELETION", label: "Account Issue", icon: "person-outline" },
  { category: "PLANT_ONBOARDING", label: "Plant Onboarding", icon: "business-outline" }, { category: "GENERAL", label: "Other Issue", icon: "help-circle-outline" },
];

const newEscalationId = () => `support-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function Support() {
  const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const { token } = useAuth();
  const [category, setCategory] = useState<Category | null>(null); const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null); const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [selectedScript, setSelectedScript] = useState<ScriptedSupportChoice | null>(null);
  const [needsMoreHelp, setNeedsMoreHelp] = useState(false); const [resolved, setResolved] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null); const [caseReply, setCaseReply] = useState("");
  const [replying, setReplying] = useState(false); const [caseError, setCaseError] = useState<string | null>(null);
  const escalationId = useRef(newEscalationId());
  const orders = useGet<{ orders: OrderData[] }>(token && (category === "ORDER" || category === "TRACKING") ? "/customer/orders" : null);
  const cases = useGet<{ cases: SupportCase[] }>(token ? "/assistant/support/cases" : null);
  const caseDetail = useGet<{ case: SupportCase }>(token && selectedCaseId ? `/assistant/support/cases/${selectedCaseId}` : null);
  const selectedOrder = useMemo(() => orders.data?.orders.find((o) => o.id === orderId), [orders.data, orderId]);
  const scriptedTopic = category ? SCRIPTED_SUPPORT[category] : null;
  const scriptedActionRoute = selectedScript?.action ? supportActionRoute(selectedScript.action, orderId) : null;

  function selectCategory(next: Category) {
    setCategory(next); setOrderId(null); setSelectedScript(null); setNeedsMoreHelp(false); setResolved(false);
    setMessage(""); setReply(null); setError(null);
  }

  function chooseScript(choice: ScriptedSupportChoice) {
    if (choice.requiresOrder && !orderId) {
      setError("Choose one of your orders first.");
      return;
    }
    setSelectedScript(choice); setResolved(false); setReply(null); setMessage(""); setError(null);
    setNeedsMoreHelp(choice.id === "other");
  }

  function generatedSupportMessage() {
    if (message.trim()) return message.trim();
    if (selectedScript) return `${selectedScript.label}: scripted guidance did not resolve the issue.`;
    return "Customer requested support after reviewing scripted guidance.";
  }

  async function createSupportCase() {
    if (!token || !category || !selectedScript || busy) return;
    if ((category === "ORDER" || category === "TRACKING") && !orderId) return setError("Choose one of your orders first.");
    setBusy(true); setError(null);
    try {
      const result = await apiPost<Reply>("/assistant/support", token, {
        category,
        message: generatedSupportMessage(),
        order_id: orderId,
        escalate: true,
        request_id: escalationId.current,
      });
      setReply(result);
      escalationId.current = newEscalationId();
      await cases.refetch();
    } catch (e) { setError(apiErrorDetail(e, "Unable to create a support case. Check your connection and retry.")); }
    finally { setBusy(false); }
  }

  function openScriptedAction() { if (scriptedActionRoute) router.push(scriptedActionRoute as never); }

  async function sendCaseReply() {
    if (!token || !selectedCaseId || !caseReply.trim() || replying) return;
    setReplying(true); setCaseError(null);
    try {
      await apiPost(`/assistant/support/cases/${selectedCaseId}/replies`, token, { message: caseReply.trim(), internal: false });
      setCaseReply(""); await Promise.all([caseDetail.refetch(), cases.refetch()]);
    } catch (e) { setCaseError(apiErrorDetail(e, "Unable to send your reply. Check your connection and retry.")); }
    finally { setReplying(false); }
  }

  return <View style={{ flex: 1, backgroundColor: colors.surface }}><View style={{ height: insets.top }} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      <View style={{ gap: spacing.sm }}><AppText variant="title">TrackMyRMC Support</AppText><AppText variant="bodyMuted">Tap the issue and get an instant answer. Type only when you need more help.</AppText>
        <Button testID="support-place-order" label="Place Order with Agent" variant="outline" onPress={() => router.push("/new-order?assistant=1" as never)}
          accessibilityHint="Prepares an order for review and requires explicit confirmation before placement" />
      </View>

      <View style={styles.grid}>{ISSUES.map((item) => <Pressable key={item.category} testID={`support-category-${item.category}`}
        accessibilityRole="button" onPress={() => selectCategory(item.category)}
        style={[styles.issue, { backgroundColor: category === item.category ? colors.brandSoft : colors.surfaceSecondary, borderColor: category === item.category ? colors.brand : colors.border }]}>
        <Ionicons name={item.icon} size={22} color={colors.brand} /><AppText variant="label">{item.label}</AppText></Pressable>)}</View>

      {(category === "ORDER" || category === "TRACKING") && <Card style={{ gap: spacing.sm }}><AppText variant="heading">Choose one of your orders</AppText>
        {orders.loading ? <AppText variant="bodyMuted">Loading your orders…</AppText> : orders.error ? <Button label="Retry loading orders" variant="outline" onPress={orders.reload} /> :
          orders.data?.orders.map((order) => <Pressable key={order.id} testID={`support-order-${order.id}`} onPress={() => { setOrderId(order.id); setSelectedScript(null); setNeedsMoreHelp(false); setResolved(false); setReply(null); setError(null); }}
            style={[styles.order, { borderColor: orderId === order.id ? colors.brand : colors.border, backgroundColor: colors.surfaceSecondary }]}> 
            <AppText variant="label">{order.order_number} · {order.grade} · {order.quantity} m³</AppText>
            <AppText variant="caption">{order.plant_name} · {order.status.replace(/_/g, " ")} · {order.payment_status}</AppText></Pressable>)}</Card>}

      {scriptedTopic ? <Card testID="support-scripted-question" style={{ gap: spacing.md }}>
        <View style={{ gap: 3 }}><AppText variant="heading">{scriptedTopic.prompt}</AppText><AppText variant="caption">Choose the closest option. You do not need to type first.</AppText></View>
        <View style={{ gap: spacing.sm }}>{scriptedTopic.choices.map((choice) => {
          const disabled = Boolean(choice.requiresOrder && !orderId);
          const selected = selectedScript?.id === choice.id;
          return <Pressable key={choice.id} testID={`support-choice-${choice.id}`} disabled={disabled} accessibilityRole="button"
            accessibilityState={{ disabled, selected }} onPress={() => chooseScript(choice)}
            style={({ pressed }) => [styles.choice, { backgroundColor: selected ? colors.brandSoft : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border, opacity: disabled ? 0.45 : pressed ? 0.78 : 1 }]}>
            <AppText style={{ flex: 1, fontFamily: fonts.semibold, color: colors.onSurface }}>{choice.label}</AppText><Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>;
        })}</View>
      </Card> : null}

      {selectedScript ? <View testID="support-instant-answer" style={[styles.agentBubble, { backgroundColor: colors.brandSoft }]}>
        <AppText variant="eyebrow">SUPPORT AGENT · INSTANT ANSWER</AppText>
        <AppText variant="heading">{selectedScript.label}</AppText>
        <AppText>{selectedScript.answer}</AppText>
        {selectedOrder ? <AppText variant="caption">Selected order: {selectedOrder.order_number} · {selectedOrder.status}</AppText> : null}
        {scriptedActionRoute ? <Button testID="support-open-secure-screen" label={selectedScript.action === "OPEN_TRACKING" ? "Open Live Tracking" : "Open secure screen"} variant="outline" onPress={openScriptedAction} /> : null}

        {resolved ? <View testID="support-resolved" style={[styles.resolved, { borderColor: colors.success + "55" }]}><Ionicons name="checkmark-circle" size={20} color={colors.success} /><AppText style={{ flex: 1 }}>Great. This issue is marked solved on this screen.</AppText></View> : null}

        {!resolved && !needsMoreHelp && !reply?.case_id ? <View testID="support-solved-question" style={{ gap: spacing.sm }}>
          <AppText variant="label">Did this solve your issue?</AppText>
          <Button testID="support-solved-yes" label="Yes, solved" onPress={() => { setResolved(true); setNeedsMoreHelp(false); }} />
          <Button testID="support-solved-no" label="No, I need more help" variant="outline" onPress={() => setNeedsMoreHelp(true)} />
        </View> : null}

        {needsMoreHelp && !reply?.case_id ? <Card testID="support-more-help" style={{ gap: spacing.md }}>
          <View style={{ gap: 3 }}><AppText variant="heading">Need more help?</AppText><AppText variant="caption">Extra details are optional. You can create a support case now without typing anything.</AppText></View>
          <TextInput testID="support-message" value={message} onChangeText={setMessage} multiline maxLength={1000}
            placeholder="Optional details. Never include passwords, OTPs, passkeys, recovery codes or payment credentials."
            placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]} />
          {error ? <AppText style={{ color: colors.error }}>{error}</AppText> : null}
          <Button testID="support-escalate" label="Create Support Case" loading={busy} disabled={busy} onPress={createSupportCase} />
          <Button testID="support-try-another" label="Try another answer" variant="outline" disabled={busy} onPress={() => { setSelectedScript(null); setNeedsMoreHelp(false); setResolved(false); setMessage(""); setReply(null); setError(null); }} />
        </Card> : null}

        {reply?.case_id ? <Card testID="support-case-confirmation"><AppText variant="heading">Support case created</AppText><AppText>{reply.case_number || reply.case_id}</AppText><AppText variant="caption">{reply.category} · {reply.case_status || "OPEN"}</AppText></Card> : null}
      </View> : null}

      <View style={{ gap: spacing.sm }}><AppText variant="heading">My Support Cases</AppText>
        {cases.loading ? <AppText variant="bodyMuted">Loading cases…</AppText> : cases.error ? <Button label="Retry" variant="outline" onPress={cases.reload} /> :
          cases.data?.cases.length ? cases.data.cases.map((item) => <Pressable key={item.id} testID={`support-case-${item.id}`} onPress={() => { setSelectedCaseId(item.id); setCaseError(null); }}><Card style={{ gap: 4 }}><AppText variant="label">{item.case_number}</AppText>
            <AppText variant="caption">{item.category.replace(/_/g, " ")} · {item.status.replace(/_/g, " ")}</AppText>
            <AppText variant="caption">{new Date(item.created_at).toLocaleString()}</AppText>{item.latest_note ? <AppText numberOfLines={2}>{item.latest_note}</AppText> : null}</Card></Pressable>) :
          <AppText variant="bodyMuted">You have no support cases.</AppText>}</View>

      {selectedCaseId && <Card testID="support-case-detail" style={{ gap: spacing.md }}>
        {caseDetail.loading ? <AppText variant="bodyMuted">Loading conversation…</AppText> : caseDetail.error ? <Button label="Retry conversation" variant="outline" onPress={caseDetail.reload} /> : caseDetail.data ? <>
          <AppText variant="heading">{caseDetail.data.case.case_number}</AppText>
          <AppText variant="caption">{caseDetail.data.case.category.replace(/_/g, " ")} · {caseDetail.data.case.status.replace(/_/g, " ")}</AppText>
          <AppText variant="caption">Created {new Date(caseDetail.data.case.created_at).toLocaleString()}</AppText>
          {caseDetail.data.case.order_id ? <AppText variant="caption">Related order: {caseDetail.data.case.order_id}</AppText> : null}
          {(caseDetail.data.case.messages || []).map((item, index) => <View key={`${item.created_at || index}-${index}`} style={[styles.messageBubble, { backgroundColor: colors.surfaceSecondary }]}> 
            <AppText variant="eyebrow">{item.author === "CUSTOMER" ? "YOU" : "SUPPORT"}</AppText><AppText>{item.message}</AppText>
          </View>)}
          {caseDetail.data.case.status === "OPEN" || caseDetail.data.case.status === "IN_PROGRESS" ? <>
            <TextInput testID="support-case-reply" value={caseReply} onChangeText={setCaseReply} multiline maxLength={1000} placeholder="Reply without sharing credentials" placeholderTextColor={colors.onSurfaceTertiary}
              style={[styles.input, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]} />
            {caseError ? <AppText style={{ color: colors.error }}>{caseError}</AppText> : null}
            <Button testID="support-case-send-reply" label="Send Reply" loading={replying} disabled={!caseReply.trim() || replying} onPress={sendCaseReply} />
          </> : <AppText testID="support-case-reply-disabled" variant="bodyMuted">This case is closed for replies.</AppText>}
        </> : null}
      </Card>}
    </ScrollView></View>;
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  issue: { width: "48%", minHeight: 72, padding: spacing.md, borderWidth: 1, borderRadius: radius.lg, gap: spacing.xs, justifyContent: "center" },
  order: { padding: spacing.md, borderWidth: 1, borderRadius: radius.md, gap: 3 },
  choice: { minHeight: 52, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: { minHeight: 112, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, textAlignVertical: "top", fontFamily: fonts.regular },
  agentBubble: { alignSelf: "stretch", padding: spacing.lg, borderRadius: radius.xl, gap: spacing.md },
  messageBubble: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  resolved: { minHeight: 52, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
