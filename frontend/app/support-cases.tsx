import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPatch, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Status = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
type Message = { message: string; author: string; internal: boolean; created_at?: string };
type Case = { id: string; case_number: string; category: string; status: Status; order_id?: string; created_at: string; messages: Message[] };
const STATUSES: Status[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export default function SupportCases() {
  const { token, user } = useAuth(); const { colors } = useTheme(); const insets = useSafeAreaInsets();
  // Keep the operational support workflow available until its mutation
  // controls have actually moved to the Control Center.
  const authorized = user?.role === "authority" || user?.role === "central_admin";
  const [filter, setFilter] = useState<Status>("OPEN"); const [caseId, setCaseId] = useState<string | null>(null);
  const [message, setMessage] = useState(""); const [internal, setInternal] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const cases = useGet<{ cases: Case[] }>(authorized && token ? "/assistant/support/staff/cases" : null);
  const detail = useGet<{ case: Case }>(authorized && token && caseId ? `/assistant/support/staff/cases/${caseId}` : null);
  const filtered = useMemo(() => (cases.data?.cases || []).filter((item) => item.status === filter), [cases.data, filter]);

  async function reply() {
    if (!token || !caseId || !message.trim() || busy) return;
    setBusy(true); setError(null);
    try { await apiPost(`/assistant/support/staff/cases/${caseId}/replies`, token, { message: message.trim(), internal }); setMessage(""); await Promise.all([detail.refetch(), cases.refetch()]); }
    catch (e) { setError(apiErrorDetail(e, "Unable to add support response.")); } finally { setBusy(false); }
  }
  async function changeStatus(status: Status) {
    if (!token || !caseId || busy) return;
    setBusy(true); setError(null);
    try { await apiPatch(`/assistant/support/staff/cases/${caseId}/status`, token, { status }); await Promise.all([detail.refetch(), cases.refetch()]); }
    catch (e) { setError(apiErrorDetail(e, "Unable to update case status.")); } finally { setBusy(false); }
  }

  if (!authorized) return <View style={[styles.center, { backgroundColor: colors.surface }]}><AppText variant="heading">Support case access is restricted.</AppText></View>;
  return <View style={{ flex: 1, backgroundColor: colors.surface }}><View style={{ height: insets.top }} /><ScrollView contentContainerStyle={styles.page}>
    <AppText variant="title">Support Cases</AppText>
    <View style={styles.row}>{STATUSES.map((status) => <Pressable key={status} testID={`support-filter-${status}`} onPress={() => setFilter(status)} style={[styles.chip, { backgroundColor: filter === status ? colors.brand : colors.surfaceSecondary, borderColor: filter === status ? colors.brand : colors.border }]}><AppText style={{ color: filter === status ? colors.onBrand : colors.onSurface, fontFamily: fonts.medium }}>{status.replace(/_/g, " ")}</AppText></Pressable>)}</View>
    {cases.loading ? <AppText variant="bodyMuted">Loading support cases…</AppText> : cases.error ? <Button label="Retry" onPress={cases.reload} /> : filtered.map((item) => <Pressable key={item.id} testID={`staff-support-case-${item.id}`} onPress={() => setCaseId(item.id)}><Card><AppText variant="label">{item.case_number}</AppText><AppText variant="caption">{item.category} · {item.status.replace(/_/g, " ")}</AppText></Card></Pressable>)}
    {caseId && <Card testID="staff-support-case-detail" style={{ gap: spacing.md }}>
      {detail.loading ? <AppText variant="bodyMuted">Loading conversation…</AppText> : detail.error ? <Button label="Retry case" onPress={detail.reload} /> : detail.data ? <>
        <AppText variant="heading">{detail.data.case.case_number}</AppText><AppText variant="caption">{detail.data.case.category} · {detail.data.case.status.replace(/_/g, " ")}</AppText>
        {detail.data.case.messages.map((item, index) => <View key={`${item.created_at || index}-${index}`} style={[styles.note, { backgroundColor: item.internal ? colors.warning + "18" : colors.surfaceSecondary }]}><AppText variant="eyebrow">{item.internal ? "INTERNAL NOTE" : item.author}</AppText><AppText>{item.message}</AppText></View>)}
        <TextInput testID="staff-support-reply" value={message} onChangeText={setMessage} multiline maxLength={1000} placeholder="Write a support response" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { color: colors.onSurface, borderColor: colors.border }]} />
        <Button testID="staff-support-note-toggle" label={internal ? "Internal note" : "Public reply"} variant="outline" onPress={() => setInternal((value) => !value)} />
        <Button testID="staff-support-send" label={internal ? "Add Internal Note" : "Send Public Reply"} loading={busy} disabled={!message.trim() || busy} onPress={reply} />
        <AppText variant="label">Change status</AppText><View style={styles.row}>{STATUSES.map((status) => <Button key={status} testID={`staff-status-${status}`} label={status.replace(/_/g, " ")} variant="outline" disabled={busy || detail.data?.case.status === status} onPress={() => changeStatus(status)} />)}</View>
        {error ? <AppText style={{ color: colors.error }}>{error}</AppText> : null}
      </> : null}
    </Card>}
  </ScrollView></View>;
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg }, page: { padding: spacing.lg, paddingBottom: 100, gap: spacing.md }, row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, chip: { minHeight: 44, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" }, note: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs }, input: { minHeight: 100, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, textAlignVertical: "top" } });
