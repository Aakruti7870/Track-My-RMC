import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Payroll = {
  id: string;
  status: string;
  basic_amount?: number;
  allowances?: number;
  overtime_amount?: number;
  deductions?: number;
  paid_days?: number;
  net_amount?: number;
  notes?: string | null;
  payment_reference?: string | null;
};

type EmployeeReport = {
  user_id: string;
  user_name: string;
  role: string;
  attendance_days: number;
  completed_shifts: number;
  open_shifts: number;
  attendance_hours: number;
  approved_leave_days: number;
  leave_days_by_type: Record<string, number>;
  completed_client_visits: number;
  approved_expenses: number;
  payroll: Payroll | null;
};

type PlantReport = {
  plant_id: string;
  plant_name: string;
  month: string;
  calendar_days: number;
  employee_count: number;
  present_records: number;
  completed_shift_records: number;
  open_shift_records: number;
  approved_leave_days: number;
  completed_client_visits: number;
  approved_expenses: number;
  payroll_total: number;
  payroll_status_counts: Record<string, number>;
  employees: EmployeeReport[];
  payroll_note: string;
};

type ReportsResponse = { month: string; reports: PlantReport[] };

type EditingPayroll = { plant: PlantReport; employee: EmployeeReport } | null;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function money(value: number | undefined) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function roleLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function payrollBadgeColor(status: string, colors: ReturnType<typeof useTheme>["colors"]) {
  if (status === "PAID" || status === "APPROVED") return colors.success;
  if (status === "RETURNED") return colors.error;
  return colors.warning;
}

export default function WorkforceReportsScreen() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<EditingPayroll>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");

  const [basic, setBasic] = useState("");
  const [allowances, setAllowances] = useState("0");
  const [overtime, setOvertime] = useState("0");
  const [deductions, setDeductions] = useState("0");
  const [paidDays, setPaidDays] = useState("0");
  const [payrollNotes, setPayrollNotes] = useState("");

  const allowed = user?.role === "plant_owner" || user?.role === "accountant";

  const load = useCallback(async () => {
    if (!token || !allowed) {
      setLoading(false);
      return;
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      toast("Month must use YYYY-MM", "error");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await apiGet<ReportsResponse>(`/workforce-reports/monthly/${month}`, token);
      setData(response);
    } catch (e: any) {
      toast(e?.detail || "Unable to load workforce report", "error");
    } finally {
      setLoading(false);
    }
  }, [token, allowed, month, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast(success, "success");
      setDecisionNote("");
      await load();
    } catch (e: any) {
      toast(e?.detail || "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const openDraft = (plant: PlantReport, employee: EmployeeReport) => {
    const payroll = employee.payroll;
    setEditing({ plant, employee });
    setBasic(String(payroll?.basic_amount ?? ""));
    setAllowances(String(payroll?.allowances ?? 0));
    setOvertime(String(payroll?.overtime_amount ?? 0));
    setDeductions(String(payroll?.deductions ?? 0));
    setPaidDays(String(payroll?.paid_days ?? employee.attendance_days));
    setPayrollNotes(payroll?.notes || "");
  };

  const saveDraft = async () => {
    if (!token || !editing) return;
    const values = [basic, allowances, overtime, deductions, paidDays].map(Number);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      toast("Enter valid non-negative payroll amounts and paid days", "error");
      return;
    }
    const [basicAmount, allowanceAmount, overtimeAmount, deductionAmount, paidDayCount] = values;
    await run(
      () => apiPut(
        `/workforce-reports/plants/${editing.plant.plant_id}/payroll/${month}/${editing.employee.user_id}/draft`,
        token,
        {
          basic_amount: basicAmount,
          allowances: allowanceAmount,
          overtime_amount: overtimeAmount,
          deductions: deductionAmount,
          paid_days: paidDayCount,
          notes: payrollNotes || undefined,
        },
      ),
      "Payroll draft saved",
    );
    setEditing(null);
  };

  const ownerDecision = async (plant: PlantReport, employee: EmployeeReport, action: "APPROVE" | "RETURN") => {
    if (!token) return;
    if (action === "RETURN" && !decisionNote.trim()) {
      toast("Enter a reason before returning payroll", "error");
      return;
    }
    await run(
      () => apiPost(
        `/workforce-reports/plants/${plant.plant_id}/payroll/${month}/${employee.user_id}/owner-decision`,
        token,
        { action, note: decisionNote || undefined },
      ),
      action === "APPROVE" ? "Payroll approved" : "Payroll returned",
    );
  };

  const markPaid = async (plant: PlantReport, employee: EmployeeReport) => {
    if (!token) return;
    if (paymentReference.trim().length < 2) {
      toast("Enter the payment reference first", "error");
      return;
    }
    const methods = ["cash", "upi", "bank_transfer", "cheque", "card"];
    if (!methods.includes(paymentMethod.trim().toLowerCase())) {
      toast("Payment method: cash / upi / bank_transfer / cheque / card", "error");
      return;
    }
    await run(
      () => apiPost(
        `/workforce-reports/plants/${plant.plant_id}/payroll/${month}/${employee.user_id}/mark-paid`,
        token,
        {
          payment_method: paymentMethod.trim().toLowerCase(),
          payment_reference: paymentReference.trim(),
        },
      ),
      "Payroll marked paid and posted to finance",
    );
    setPaymentReference("");
  };

  const shareReport = async (report: PlantReport) => {
    const lines = [
      `${report.plant_name} · Workforce Report · ${report.month}`,
      `Employees: ${report.employee_count}`,
      `Attendance records: ${report.present_records}`,
      `Approved leave days: ${report.approved_leave_days}`,
      `Completed client visits: ${report.completed_client_visits}`,
      `Approved staff expenses: ${money(report.approved_expenses)}`,
      `Payroll total on record: ${money(report.payroll_total)}`,
      "",
      ...report.employees.map((e) => `${e.user_name}: ${e.attendance_days} attendance days · ${e.approved_leave_days} leave days · payroll ${e.payroll?.status || "NOT PREPARED"}`),
      "",
      report.payroll_note,
    ];
    await Share.share({ message: lines.join("\n") });
  };

  if (!allowed) {
    return (
      <View style={[styles.center, { backgroundColor: colors.surface }]}>
        <AppText variant="heading">Payroll reporting is restricted.</AppText>
        <AppText variant="caption" center>Only Plant Owner and Accountant accounts can access this page.</AppText>
        <Button label="Go Back" onPress={() => router.back()} />
      </View>
    );
  }

  if (loading && !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brand} />
        <AppText variant="caption">Loading workforce report…</AppText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={[styles.back, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Workforce Reports</AppText>
          <AppText variant="caption">Monthly evidence · Payroll control</AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <Card style={{ gap: spacing.md }}>
          <View style={styles.titleRow}>
            <View style={[styles.iconCircle, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="calendar-outline" size={20} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="heading">Reporting month</AppText>
              <AppText variant="caption">Use YYYY-MM. Salary is never inferred automatically.</AppText>
            </View>
          </View>
          <Input label="Month" value={month} onChangeText={setMonth} placeholder="2026-08" />
          <Button label="Refresh Report" variant="outline" loading={loading} onPress={load} />
        </Card>

        {user?.role === "plant_owner" ? (
          <Card style={{ gap: spacing.sm }}>
            <AppText variant="label">Owner decision note</AppText>
            <Input value={decisionNote} onChangeText={setDecisionNote} placeholder="Required when returning payroll" autoCapitalize="sentences" />
          </Card>
        ) : null}

        {user?.role === "accountant" ? (
          <Card style={{ gap: spacing.sm }}>
            <AppText variant="label">Payment posting</AppText>
            <AppText variant="caption">Used only when marking an Owner-approved payroll as paid.</AppText>
            <Input label="Payment method" value={paymentMethod} onChangeText={setPaymentMethod} placeholder="bank_transfer / upi / cash / cheque / card" autoCapitalize="none" />
            <Input label="Payment reference" value={paymentReference} onChangeText={setPaymentReference} placeholder="UTR / transaction / cheque reference" />
          </Card>
        ) : null}

        {editing ? (
          <Card style={{ gap: spacing.md }}>
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">Prepare Payroll · {editing.employee.user_name}</AppText>
                <AppText variant="caption">Evidence: {editing.employee.attendance_days} attendance days · {editing.employee.approved_leave_days} approved leave days</AppText>
              </View>
              <Pressable onPress={() => setEditing(null)}><Ionicons name="close" size={22} color={colors.onSurfaceSecondary} /></Pressable>
            </View>
            <Input label="Basic amount" value={basic} onChangeText={setBasic} keyboardType="decimal-pad" placeholder="0" />
            <Input label="Allowances" value={allowances} onChangeText={setAllowances} keyboardType="decimal-pad" placeholder="0" />
            <Input label="Overtime amount" value={overtime} onChangeText={setOvertime} keyboardType="decimal-pad" placeholder="0" />
            <Input label="Deductions" value={deductions} onChangeText={setDeductions} keyboardType="decimal-pad" placeholder="0" />
            <Input label="Paid days" value={paidDays} onChangeText={setPaidDays} keyboardType="decimal-pad" placeholder="0" />
            <Input label="Notes" value={payrollNotes} onChangeText={setPayrollNotes} placeholder="Payroll note" autoCapitalize="sentences" />
            <Button label="Save Draft for Owner Approval" loading={busy} onPress={saveDraft} />
          </Card>
        ) : null}

        {(data?.reports || []).map((report) => (
          <View key={report.plant_id} style={{ gap: spacing.lg }}>
            <Card style={{ gap: spacing.md }}>
              <View style={styles.titleRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="heading">{report.plant_name}</AppText>
                  <AppText variant="caption">{report.month} · {report.calendar_days} calendar days</AppText>
                </View>
                <Button label="Share" size="sm" variant="outline" onPress={() => shareReport(report)} />
              </View>
              <View style={styles.metrics}>
                <Metric label="Employees" value={String(report.employee_count)} />
                <Metric label="Attendance" value={String(report.present_records)} />
                <Metric label="Leave days" value={String(report.approved_leave_days)} />
                <Metric label="Visits" value={String(report.completed_client_visits)} />
                <Metric label="Staff expenses" value={money(report.approved_expenses)} compact />
                <Metric label="Payroll" value={money(report.payroll_total)} compact />
              </View>
              {report.open_shift_records > 0 ? (
                <View style={[styles.warningBox, { backgroundColor: colors.surfaceSecondary }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                  <AppText variant="caption" style={{ flex: 1 }}>{report.open_shift_records} attendance record(s) have Punch In without Punch Out.</AppText>
                </View>
              ) : null}
              <AppText variant="caption">{report.payroll_note}</AppText>
            </Card>

            <Card style={{ gap: spacing.md }}>
              <AppText variant="heading">Employee monthly records</AppText>
              {report.employees.length === 0 ? <AppText variant="caption">No active plant workforce found.</AppText> : report.employees.map((employee) => {
                const payroll = employee.payroll;
                return (
                  <View key={employee.user_id} style={[styles.employee, { borderColor: colors.border }]}>
                    <View style={styles.titleRow}>
                      <View style={{ flex: 1 }}>
                        <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{employee.user_name}</AppText>
                        <AppText variant="caption">{roleLabel(employee.role)}</AppText>
                      </View>
                      <Badge label={payroll?.status || "NOT PREPARED"} color={payroll ? payrollBadgeColor(payroll.status, colors) : colors.onSurfaceTertiary} />
                    </View>

                    <View style={styles.evidenceGrid}>
                      <Evidence label="Attendance" value={`${employee.attendance_days} days`} />
                      <Evidence label="Completed shifts" value={String(employee.completed_shifts)} />
                      <Evidence label="Hours" value={String(employee.attendance_hours)} />
                      <Evidence label="Approved leave" value={`${employee.approved_leave_days} days`} />
                      <Evidence label="Client visits" value={String(employee.completed_client_visits)} />
                      <Evidence label="Expenses" value={money(employee.approved_expenses)} />
                    </View>

                    {payroll ? (
                      <View style={[styles.payrollBox, { backgroundColor: colors.surfaceSecondary }]}>
                        <View style={{ flex: 1 }}>
                          <AppText variant="label">Payroll on record</AppText>
                          <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onSurface }}>{money(payroll.net_amount)}</AppText>
                          <AppText variant="caption">Paid days: {payroll.paid_days ?? 0}</AppText>
                          {payroll.payment_reference ? <AppText variant="caption">Ref: {payroll.payment_reference}</AppText> : null}
                        </View>
                      </View>
                    ) : null}

                    {user?.role === "accountant" && (!payroll || ["DRAFT", "RETURNED"].includes(payroll.status)) ? (
                      <Button label={payroll ? "Edit Payroll Draft" : "Prepare Payroll"} size="sm" onPress={() => openDraft(report, employee)} />
                    ) : null}
                    {user?.role === "accountant" && payroll?.status === "APPROVED" ? (
                      <Button label="Mark Paid + Post to Finance" size="sm" loading={busy} onPress={() => markPaid(report, employee)} />
                    ) : null}
                    {user?.role === "plant_owner" && payroll?.status === "DRAFT" ? (
                      <View style={styles.actions}>
                        <Button label="Approve" size="sm" loading={busy} onPress={() => ownerDecision(report, employee, "APPROVE")} />
                        <Button label="Return" size="sm" variant="outline" loading={busy} onPress={() => ownerDecision(report, employee, "RETURN")} />
                      </View>
                    ) : null}
                    {user?.role === "plant_owner" && payroll?.status === "APPROVED" ? (
                      <Button label="Return for Correction" size="sm" variant="outline" loading={busy} onPress={() => ownerDecision(report, employee, "RETURN")} />
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: colors.surfaceSecondary }]}>
      <AppText style={{ fontFamily: fonts.displayBold, fontSize: compact ? fontSize.lg : fontSize.xl, color: colors.onSurface }} numberOfLines={1}>{value}</AppText>
      <AppText variant="caption" center>{label}</AppText>
    </View>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.evidence, { backgroundColor: colors.surfaceSecondary }]}>
      <AppText variant="caption">{label}</AppText>
      <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { width: "31%", minHeight: 76, borderRadius: radius.md, padding: spacing.sm, alignItems: "center", justifyContent: "center" },
  warningBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  employee: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  evidenceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  evidence: { width: "48%", borderRadius: radius.sm, padding: spacing.sm, gap: 2 },
  payrollBox: { flexDirection: "row", borderRadius: radius.md, padding: spacing.md },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
