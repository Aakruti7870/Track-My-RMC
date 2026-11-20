import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGet } from "@/src/hooks/useApi";
import { ErrorView } from "@/src/components/StateViews";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Payslip = {
  payslip_number: string;
  month: string;
  employee_name: string;
  employee_code?: string | null;
  designation?: string | null;
  department?: string | null;
  closure_version: number;
  notice?: string;
  payroll_snapshot: {
    basic_amount: number;
    allowances: number;
    overtime_amount: number;
    deductions: number;
    paid_days: number;
    net_amount: number;
    attendance_evidence?: Record<string, unknown>;
    payment_method?: string | null;
    payment_reference?: string | null;
    paid_on?: string | null;
  };
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function message(p: Payslip) {
  const r = p.payroll_snapshot;
  return [
    `TrackMyRMC Payslip ${p.payslip_number}`,
    `Month: ${p.month}`,
    `Employee: ${p.employee_name}${p.employee_code ? ` (${p.employee_code})` : ""}`,
    p.designation ? `Designation: ${p.designation}` : null,
    `Basic: ${money(r.basic_amount)}`,
    `Allowances: ${money(r.allowances)}`,
    `Overtime: ${money(r.overtime_amount)}`,
    `Deductions: ${money(r.deductions)}`,
    `Paid days: ${r.paid_days}`,
    `Net paid: ${money(r.net_amount)}`,
    `Payment: ${r.payment_method || "-"} · ${r.payment_reference || "-"}`,
    `Paid on: ${r.paid_on || "-"}`,
    `Closure version: ${p.closure_version}`,
  ].filter(Boolean).join("\n");
}

export default function MyPayslipScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(currentMonth);
  const monthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const { data, loading, error, reload } = useGet<{ payslip: Payslip | null; historical: boolean; period_status: string }>(
    monthValid ? `/payroll-periods/me/${month}` : null,
  );
  const { payslip, historical, period_status: periodStatus } = data ?? {};

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={[styles.iconButton, { borderColor: colors.border }]}><Ionicons name="arrow-back" size={20} color={colors.onSurface} /></Pressable>
          <View style={{ flex: 1 }}><AppText variant="title">My Payslip</AppText><AppText variant="caption">Owner-approved payroll snapshot for a closed month</AppText></View>
        </View>

        <Card style={{ gap: spacing.md }}>
          <Input label="Month (YYYY-MM)" value={month} onChangeText={setMonth} placeholder="2026-08" />
          <Button label="Load Payslip" disabled={!monthValid} loading={loading} onPress={reload} />
        </Card>

        {error ? <ErrorView message={error} onRetry={reload} /> : loading ? <ActivityIndicator color={colors.brand} /> : payslip ? <>
          <Card style={{ gap: spacing.md }}>
            <View style={styles.rowBetween}><View style={{ flex: 1 }}><AppText variant="heading">{payslip.employee_name}</AppText><AppText variant="caption">{payslip.employee_code || payslip.designation || "Employee"}</AppText></View><Badge label={historical ? "HISTORICAL" : periodStatus || "CLOSED"} color={historical ? colors.warning : colors.brand} /></View>
            <AppText variant="caption">{payslip.month} · {payslip.payslip_number} · Version {payslip.closure_version}</AppText>
            <View style={styles.amount}><AppText variant="caption">Net paid</AppText><AppText variant="title">{money(payslip.payroll_snapshot.net_amount)}</AppText></View>
            <View style={styles.grid}>
              <View><AppText variant="caption">Basic</AppText><AppText style={{ fontFamily: fonts.semibold }}>{money(payslip.payroll_snapshot.basic_amount)}</AppText></View>
              <View><AppText variant="caption">Allowances</AppText><AppText style={{ fontFamily: fonts.semibold }}>{money(payslip.payroll_snapshot.allowances)}</AppText></View>
              <View><AppText variant="caption">Overtime</AppText><AppText style={{ fontFamily: fonts.semibold }}>{money(payslip.payroll_snapshot.overtime_amount)}</AppText></View>
              <View><AppText variant="caption">Deductions</AppText><AppText style={{ fontFamily: fonts.semibold }}>{money(payslip.payroll_snapshot.deductions)}</AppText></View>
            </View>
            <AppText variant="caption">Paid days: {payslip.payroll_snapshot.paid_days}</AppText>
            <AppText variant="caption">Payment: {payslip.payroll_snapshot.payment_method || "-"} · {payslip.payroll_snapshot.payment_reference || "-"}</AppText>
            <AppText variant="caption">Paid on: {payslip.payroll_snapshot.paid_on || "-"}</AppText>
            <Button label="Share / Save Payslip" onPress={() => Share.share({ title: payslip.payslip_number, message: message(payslip) })} />
            <AppText variant="caption">{payslip.notice || "This payslip is a historical snapshot and cannot be changed by later salary-master edits."}</AppText>
          </Card>
        </> : monthValid ? <Card><AppText variant="caption">No issued payslip found for {month}. Payslips become available after the Plant Owner closes a fully-paid payroll month.</AppText></Card> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconButton: { width: 42, height: 42, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  amount: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.lg },
});
