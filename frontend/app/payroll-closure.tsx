import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useGet } from "@/src/hooks/useApi";
import { ErrorView } from "@/src/components/StateViews";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Readiness = {
  ready: boolean;
  employee_count: number;
  paid_count: number;
  missing_user_ids: string[];
  unpaid: { user_id: string; status: string }[];
  payment_locked_user_ids: string[];
};
type Period = {
  plant_id: string;
  plant_name: string;
  month: string;
  status: string;
  version: number;
  closed_at?: string | null;
  reopen_reason?: string | null;
  payslip_count: number;
  readiness: Readiness;
};
type Payslip = {
  id: string;
  payslip_number: string;
  month: string;
  employee_code?: string | null;
  employee_name: string;
  role: string;
  closure_version: number;
  payroll_snapshot: {
    basic_amount: number;
    allowances: number;
    overtime_amount: number;
    deductions: number;
    paid_days: number;
    net_amount: number;
    payment_method?: string | null;
    payment_reference?: string | null;
    paid_on?: string | null;
  };
};

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function payslipMessage(p: Payslip) {
  const row = p.payroll_snapshot || ({} as Payslip["payroll_snapshot"]);
  return [
    `TrackMyRMC Payslip ${p.payslip_number}`,
    `Month: ${p.month}`,
    `Employee: ${p.employee_name}${p.employee_code ? ` (${p.employee_code})` : ""}`,
    `Basic: ${money(row.basic_amount)}`,
    `Allowances: ${money(row.allowances)}`,
    `Overtime: ${money(row.overtime_amount)}`,
    `Deductions: ${money(row.deductions)}`,
    `Paid days: ${row.paid_days}`,
    `Net paid: ${money(row.net_amount)}`,
    `Payment: ${row.payment_method || "-"} · ${row.payment_reference || "-"}`,
    `Paid on: ${row.paid_on || "-"}`,
    `Closure version: ${p.closure_version}`,
  ].join("\n");
}

export default function PayrollClosureScreen() {
  const { colors } = useTheme();
  const { token, user, hydrating } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [month, setMonth] = useState(monthKey);
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = user?.role === "plant_owner" || user?.role === "owner";
  const allowed = isOwner || user?.role === "accountant";
  const monthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const periodsRequest = useGet<{ periods: Period[] }>(allowed && monthValid ? `/payroll-periods/${month}` : null);
  const periods = periodsRequest.data?.periods ?? [];
  const period = periods.find(p => p.plant_id === selectedPlant) ?? periods[0];
  const slipsRequest = useGet<{ payslips: Payslip[] }>(
    period ? `/payroll-periods/plants/${period.plant_id}/${period.month}/payslips` : null,
  );
  const payslips = slipsRequest.data?.payslips ?? [];
  const load = () => Promise.all([periodsRequest.reload(), slipsRequest.reload()]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await fn(); toast(message, "success"); await load(); }
    catch (e: any) { toast(typeof e?.detail === "string" ? e.detail : "Payroll action failed", "error"); }
    finally { setBusy(false); }
  };

  const exportCsv = async () => {
    if (!token || !period || period.month !== month) return;
    setBusy(true);
    try {
      const out = await apiGet<{ filename: string; csv: string }>(`/payroll-periods/plants/${period.plant_id}/${period.month}/export`, token);
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = out.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        await Share.share({ title: out.filename, message: out.csv });
      }
    } catch (e: any) { toast(e?.detail || "Unable to export payroll", "error"); }
    finally { setBusy(false); }
  };

  if (hydrating) return <ActivityIndicator accessibilityLabel="Loading account" color={colors.brand} />;
  if (!allowed) return <View style={[styles.center, { backgroundColor: colors.surface }]}><AppText>Payroll closure is available to Plant Owner and Accountant only.</AppText></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={[styles.iconButton, { borderColor: colors.border }]}><Ionicons name="arrow-back" size={20} color={colors.onSurface} /></Pressable>
          <View style={{ flex: 1 }}><AppText variant="title">Payroll Closure</AppText><AppText variant="caption">Close paid months, issue immutable payslips and export payroll</AppText></View>
        </View>

        <Card style={{ gap: spacing.md }}>
          <Input label="Payroll month (YYYY-MM)" value={month} editable={!busy} onChangeText={value => { setMonth(value); setReopenReason(""); }} placeholder="2026-08" />
          <Button label="Load Month" disabled={busy || !monthValid} loading={periodsRequest.loading} onPress={load} />
          {periods.length > 1 ? <View style={styles.wrap}>{periods.map((p) => <Pressable key={p.plant_id} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: p.plant_id === period?.plant_id }} onPress={() => { setSelectedPlant(p.plant_id); setReopenReason(""); }} style={[styles.chip, { borderColor: p.plant_id === period?.plant_id ? colors.brand : colors.border }]}><AppText style={{ fontFamily: fonts.semibold }}>{p.plant_name}</AppText></Pressable>)}</View> : null}
        </Card>

        {periodsRequest.error ? <ErrorView message={periodsRequest.error} onRetry={periodsRequest.reload} /> : null}

        {period ? <>
          <Card style={{ gap: spacing.md }}>
            <View style={styles.rowBetween}><View style={{ flex: 1 }}><AppText variant="heading">{period.plant_name}</AppText><AppText variant="caption">{period.month} · closure version {period.version || 0}</AppText></View><Badge label={period.status} color={period.status === "CLOSED" ? colors.brand : colors.warning} /></View>
            <View style={styles.metrics}>
              <View><AppText variant="caption">Employees</AppText><AppText variant="heading">{period.readiness.employee_count}</AppText></View>
              <View><AppText variant="caption">Paid</AppText><AppText variant="heading">{period.readiness.paid_count}</AppText></View>
              <View><AppText variant="caption">Payslips</AppText><AppText variant="heading">{period.payslip_count}</AppText></View>
            </View>
            <AppText variant="caption">{period.readiness.ready ? "Ready to close: every active employee payroll is paid and no payment lock is active." : `Not ready: ${period.readiness.missing_user_ids.length} missing, ${period.readiness.unpaid.length} unpaid, ${period.readiness.payment_locked_user_ids.length} payment lock(s).`}</AppText>
            {isOwner && period.status !== "CLOSED" ? <Button label="Close Payroll Month" disabled={busy || !period.readiness.ready} onPress={() => run(() => apiPost(`/payroll-periods/plants/${period.plant_id}/${period.month}/close`, token!, {}), "Payroll month closed and payslips issued")} /> : null}
            {isOwner && period.status === "CLOSED" ? <>
              <Input label="Reopen reason" value={reopenReason} onChangeText={setReopenReason} placeholder="Mandatory audited reason" />
              <Button label="Reopen Period" variant="secondary" disabled={busy || reopenReason.trim().length < 5} onPress={() => run(() => apiPost(`/payroll-periods/plants/${period.plant_id}/${period.month}/reopen`, token!, { reason: reopenReason.trim() }), "Payroll month reopened")} />
            </> : null}
            {payslips.length ? <Button label="Share / Save Payroll CSV" variant="secondary" disabled={busy} onPress={exportCsv} /> : null}
          </Card>

          <Card style={{ gap: spacing.md }}>
            <AppText variant="heading">Payslips</AppText>
            {slipsRequest.error ? <ErrorView message={slipsRequest.error} onRetry={slipsRequest.reload} /> : slipsRequest.loading ? <ActivityIndicator color={colors.brand} /> : !payslips.length ? <AppText variant="caption">Payslips are created only when the Plant Owner closes a fully-paid payroll month.</AppText> : payslips.map((p) => <View key={p.id} style={[styles.slip, { borderColor: colors.border }]}>
              <View style={styles.rowBetween}><View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold }}>{p.employee_name}</AppText><AppText variant="caption">{p.employee_code || p.role} · {p.payslip_number}</AppText></View><AppText variant="heading">{money(p.payroll_snapshot.net_amount)}</AppText></View>
              <AppText variant="caption">Paid days {p.payroll_snapshot.paid_days} · {p.payroll_snapshot.payment_method || "-"} · {p.payroll_snapshot.payment_reference || "-"}</AppText>
              <Pressable onPress={() => Share.share({ title: p.payslip_number, message: payslipMessage(p) })} style={[styles.share, { borderColor: colors.border }]}><Ionicons name="share-outline" size={17} color={colors.brand} /><AppText style={{ fontFamily: fonts.semibold }}>Share / Save Payslip</AppText></Pressable>
            </View>)}
          </Card>
        </> : monthValid && !periodsRequest.loading && !periodsRequest.error ? <Card><AppText variant="caption">No plant payroll period is available for this account.</AppText></Card> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconButton: { width: 42, height: 42, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  metrics: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  slip: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  share: { minHeight: 42, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
});
