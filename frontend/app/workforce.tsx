import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Attendance = {
  id: string;
  date: string;
  user_name?: string;
  role?: string;
  check_in?: string | null;
  check_out?: string | null;
};

type Leave = {
  id: string;
  user_name?: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
};

type Visit = {
  id: string;
  user_name?: string;
  client_name: string;
  purpose: string;
  scheduled_for: string;
  site_address: string;
  status: string;
};

type ExpenseClaim = {
  id: string;
  user_name?: string;
  category: string;
  amount: number;
  expense_date: string;
  description: string;
  receipt_reference?: string | null;
  status: string;
};

type EmployeeData = {
  mode: "employee";
  plant_id: string;
  role: string;
  attendance: Attendance | null;
  attendance_history: Attendance[];
  leave_requests: Leave[];
  client_visits: Visit[];
  expense_claims: ExpenseClaim[];
  can_verify_expenses: boolean;
};

type OwnerData = {
  mode: "owner_control";
  plant_ids: string[];
  attendance: Attendance[];
  leave_requests: Leave[];
  client_visits: Visit[];
  expense_claims: ExpenseClaim[];
};

type FormMode = "leave" | "visit" | "expense" | null;

function fmtDateTime(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowLocalInput() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function locationEvidence() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    throw { detail: "Location permission is required for attendance and field visits" };
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy_m: pos.coords.accuracy ?? undefined,
  };
}

function StatusBadge({ status }: { status: string }) {
  const { colors } = useTheme();
  const positive = ["APPROVED", "VERIFIED", "COMPLETED", "IN_PROGRESS"].includes(status);
  const negative = ["REJECTED", "RETURNED"].includes(status);
  return <Badge label={status.replaceAll("_", " ")} color={negative ? colors.error : positive ? colors.success : colors.warning} />;
}

function SectionTitle({ icon, title, subtitle }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <View style={[styles.sectionIcon, { backgroundColor: colors.surfaceSecondary }]}>
        <Ionicons name={icon} size={20} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="heading">{title}</AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </View>
    </View>
  );
}

export default function WorkforceScreen() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [owner, setOwner] = useState<OwnerData | null>(null);
  const [accountantClaims, setAccountantClaims] = useState<ExpenseClaim[]>([]);
  const [form, setForm] = useState<FormMode>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const [leaveType, setLeaveType] = useState("CASUAL");
  const [leaveStart, setLeaveStart] = useState(todayIso());
  const [leaveEnd, setLeaveEnd] = useState(todayIso());
  const [leaveReason, setLeaveReason] = useState("");

  const [clientName, setClientName] = useState("");
  const [visitPurpose, setVisitPurpose] = useState("");
  const [visitWhen, setVisitWhen] = useState(tomorrowLocalInput());
  const [visitAddress, setVisitAddress] = useState("");

  const [expenseCategory, setExpenseCategory] = useState("TRAVEL");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseReceipt, setExpenseReceipt] = useState("");

  const load = useCallback(async () => {
    if (!token || !user) return;
    try {
      if (user.role === "plant_owner") {
        const data = await apiGet<OwnerData>("/workforce/owner/control", token);
        setOwner(data);
        setEmployee(null);
      } else {
        const data = await apiGet<EmployeeData>("/workforce/me", token);
        setEmployee(data);
        setOwner(null);
        if (user.role === "accountant") {
          const review = await apiGet<{ expense_claims: ExpenseClaim[] }>("/workforce/accountant/expenses", token);
          setAccountantClaims(review.expense_claims);
        }
      }
    } catch (e: any) {
      toast(e?.detail || "Unable to load workforce data", "error");
    } finally {
      setLoading(false);
    }
  }, [token, user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast(success, "success");
      await load();
    } catch (e: any) {
      toast(e?.detail || "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const attendanceAction = async (path: "punch-in" | "punch-out") => {
    if (!token) return;
    const evidence = await locationEvidence();
    await run(() => apiPost(`/workforce/attendance/${path}`, token, evidence), path === "punch-in" ? "Punched in" : "Punched out");
  };

  const visitAction = async (visitId: string, action: "start" | "complete") => {
    if (!token) return;
    const evidence = await locationEvidence();
    await run(
      () => apiPost(`/workforce/visits/${visitId}/${action}`, token, { ...evidence, outcome: action === "complete" ? "Visit completed" : undefined }),
      action === "start" ? "Client visit started" : "Client visit completed",
    );
  };

  const submitLeave = async () => {
    if (!token) return;
    await run(
      () => apiPost("/workforce/leave", token, {
        leave_type: leaveType.trim().toUpperCase(),
        start_date: leaveStart,
        end_date: leaveEnd,
        reason: leaveReason,
      }),
      "Leave request submitted",
    );
    setLeaveReason("");
    setForm(null);
  };

  const submitVisit = async () => {
    if (!token) return;
    const scheduled = new Date(visitWhen);
    if (Number.isNaN(scheduled.getTime())) {
      toast("Enter visit time as YYYY-MM-DDTHH:mm", "error");
      return;
    }
    await run(
      () => apiPost("/workforce/visits", token, {
        client_name: clientName,
        purpose: visitPurpose,
        scheduled_for: scheduled.toISOString(),
        site_address: visitAddress,
      }),
      "Client visit sent for approval",
    );
    setClientName("");
    setVisitPurpose("");
    setVisitAddress("");
    setForm(null);
  };

  const submitExpense = async () => {
    if (!token) return;
    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Enter a valid expense amount", "error");
      return;
    }
    await run(
      () => apiPost("/workforce/expenses", token, {
        category: expenseCategory,
        amount,
        expense_date: expenseDate,
        description: expenseDescription,
        receipt_reference: expenseReceipt || undefined,
      }),
      "Expense claim submitted",
    );
    setExpenseAmount("");
    setExpenseDescription("");
    setExpenseReceipt("");
    setForm(null);
  };

  const accountantDecision = async (claimId: string, action: "VERIFY" | "RETURN") => {
    if (!token) return;
    if (action === "RETURN" && !decisionNote.trim()) {
      toast("Enter a note before returning a claim", "error");
      return;
    }
    await run(
      () => apiPost(`/workforce/accountant/expenses/${claimId}/decision`, token, { action, note: decisionNote || undefined }),
      action === "VERIFY" ? "Expense verified" : "Expense returned",
    );
  };

  const ownerDecision = async (kind: "leave" | "visits" | "expenses", id: string, action: "APPROVE" | "REJECT") => {
    if (!token) return;
    if (action === "REJECT" && !decisionNote.trim()) {
      toast("Enter a rejection reason first", "error");
      return;
    }
    await run(
      () => apiPost(`/workforce/owner/${kind}/${id}/decision`, token, { action, note: decisionNote || undefined }),
      action === "APPROVE" ? "Approved" : "Rejected",
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brand} />
        <AppText variant="caption">Loading workforce hub…</AppText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.header}>
        <Pressable testID="workforce-back" onPress={() => router.back()} style={[styles.back, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Workforce & Field</AppText>
          <AppText variant="caption">Attendance · Leave · Visits · Expenses</AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        {owner ? (
          <OwnerControl data={owner} decisionNote={decisionNote} setDecisionNote={setDecisionNote} busy={busy} onDecision={ownerDecision} />
        ) : employee ? (
          <>
            <AttendanceCard attendance={employee.attendance} busy={busy} onPunch={attendanceAction} />

            <View style={styles.quickRow}>
              <QuickAction icon="calendar-outline" label="Apply Leave" active={form === "leave"} onPress={() => setForm(form === "leave" ? null : "leave")} />
              <QuickAction icon="navigate-outline" label="Client Visit" active={form === "visit"} onPress={() => setForm(form === "visit" ? null : "visit")} />
              <QuickAction icon="wallet-outline" label="Expense" active={form === "expense"} onPress={() => setForm(form === "expense" ? null : "expense")} />
            </View>

            {form === "leave" ? (
              <Card style={{ gap: spacing.md }}>
                <SectionTitle icon="calendar-outline" title="Apply for leave" subtitle="Plant Owner approval is required" />
                <Input label="Leave type" value={leaveType} onChangeText={setLeaveType} placeholder="CASUAL / SICK / PAID / UNPAID / OTHER" autoCapitalize="characters" />
                <Input label="Start date" value={leaveStart} onChangeText={setLeaveStart} placeholder="YYYY-MM-DD" />
                <Input label="End date" value={leaveEnd} onChangeText={setLeaveEnd} placeholder="YYYY-MM-DD" />
                <Input label="Reason" value={leaveReason} onChangeText={setLeaveReason} placeholder="Reason for leave" autoCapitalize="sentences" />
                <Button label="Submit Leave Request" loading={busy} onPress={submitLeave} />
              </Card>
            ) : null}

            {form === "visit" ? (
              <Card style={{ gap: spacing.md }}>
                <SectionTitle icon="navigate-outline" title="Schedule client visit" subtitle="Start and complete actions record live location" />
                <Input label="Client / site" value={clientName} onChangeText={setClientName} placeholder="Client name" autoCapitalize="words" />
                <Input label="Purpose" value={visitPurpose} onChangeText={setVisitPurpose} placeholder="Purpose of visit" autoCapitalize="sentences" />
                <Input label="Scheduled time" value={visitWhen} onChangeText={setVisitWhen} placeholder="YYYY-MM-DDTHH:mm" />
                <Input label="Site address" value={visitAddress} onChangeText={setVisitAddress} placeholder="Client/site address" autoCapitalize="words" />
                <Button label="Request Visit Approval" loading={busy} onPress={submitVisit} />
              </Card>
            ) : null}

            {form === "expense" ? (
              <Card style={{ gap: spacing.md }}>
                <SectionTitle icon="wallet-outline" title="Submit expense claim" subtitle="Accountant verification → Owner approval → Finance ledger" />
                <Input label="Category" value={expenseCategory} onChangeText={setExpenseCategory} placeholder="TRAVEL / FUEL / FOOD / OTHER" autoCapitalize="characters" />
                <Input label="Amount (₹)" value={expenseAmount} onChangeText={setExpenseAmount} placeholder="0.00" keyboardType="decimal-pad" />
                <Input label="Expense date" value={expenseDate} onChangeText={setExpenseDate} placeholder="YYYY-MM-DD" />
                <Input label="Details" value={expenseDescription} onChangeText={setExpenseDescription} placeholder="What was this expense for?" autoCapitalize="sentences" />
                <Input label="Receipt reference (optional)" value={expenseReceipt} onChangeText={setExpenseReceipt} placeholder="Receipt no. / uploaded file reference" />
                <Button label="Submit Expense Claim" loading={busy} onPress={submitExpense} />
              </Card>
            ) : null}

            <MyActivity data={employee} busy={busy} onVisitAction={visitAction} />

            {user?.role === "accountant" ? (
              <Card style={{ gap: spacing.md }}>
                <SectionTitle icon="checkmark-done-outline" title="Expense verification" subtitle="Verify before Plant Owner final approval" />
                <Input label="Review note" value={decisionNote} onChangeText={setDecisionNote} placeholder="Required when returning a claim" autoCapitalize="sentences" />
                {accountantClaims.filter((claim) => ["SUBMITTED", "RETURNED"].includes(claim.status)).length === 0 ? (
                  <AppText variant="caption">No expense claims waiting for verification.</AppText>
                ) : accountantClaims.filter((claim) => ["SUBMITTED", "RETURNED"].includes(claim.status)).map((claim) => (
                  <View key={claim.id} style={[styles.reviewRow, { borderColor: colors.border }]}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{claim.user_name || "Staff"} · ₹{claim.amount.toFixed(2)}</AppText>
                      <AppText variant="caption">{claim.category} · {claim.expense_date}</AppText>
                      <AppText variant="caption">{claim.description}</AppText>
                    </View>
                    <View style={styles.actionCol}>
                      <Button label="Verify" size="sm" loading={busy} onPress={() => accountantDecision(claim.id, "VERIFY")} />
                      <Button label="Return" size="sm" variant="outline" loading={busy} onPress={() => accountantDecision(claim.id, "RETURN")} />
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        ) : (
          <Card><AppText>This account does not have Workforce Hub access.</AppText></Card>
        )}
      </ScrollView>
    </View>
  );
}

function AttendanceCard({ attendance, busy, onPunch }: { attendance: Attendance | null; busy: boolean; onPunch: (path: "punch-in" | "punch-out") => Promise<void> }) {
  const { colors } = useTheme();
  const checkedIn = !!attendance?.check_in && !attendance?.check_out;
  const done = !!attendance?.check_out;
  return (
    <Card style={{ gap: spacing.md }}>
      <SectionTitle icon="finger-print-outline" title="My Workday" subtitle="Location-evidenced attendance" />
      <View style={[styles.attendanceState, { backgroundColor: colors.surfaceSecondary }]}>
        <View style={[styles.statusDot, { backgroundColor: done || checkedIn ? colors.success : colors.warning }]} />
        <View style={{ flex: 1 }}>
          <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{done ? "Shift complete" : checkedIn ? "On duty" : "Not punched in"}</AppText>
          <AppText variant="caption">In: {fmtDateTime(attendance?.check_in)} · Out: {fmtDateTime(attendance?.check_out)}</AppText>
        </View>
      </View>
      {!checkedIn && !done ? <Button label="Punch In with Location" loading={busy} onPress={() => onPunch("punch-in")} icon={<Ionicons name="location-outline" size={18} color={colors.onBrand} />} /> : null}
      {checkedIn ? <Button label="Punch Out with Location" variant="outline" loading={busy} onPress={() => onPunch("punch-out")} /> : null}
    </Card>
  );
}

function QuickAction({ icon, label, active, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.quick, { backgroundColor: active ? colors.brand : colors.surfaceSecondary, borderColor: active ? colors.brand : colors.border }]}>
      <Ionicons name={icon} size={22} color={active ? colors.onBrand : colors.brand} />
      <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.sm, color: active ? colors.onBrand : colors.onSurface, textAlign: "center" }}>{label}</AppText>
    </Pressable>
  );
}

function MyActivity({ data, busy, onVisitAction }: { data: EmployeeData; busy: boolean; onVisitAction: (id: string, action: "start" | "complete") => Promise<void> }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.lg }}>
      <Card style={{ gap: spacing.md }}>
        <SectionTitle icon="calendar-number-outline" title="Leave requests" />
        {data.leave_requests.length === 0 ? <AppText variant="caption">No leave requests yet.</AppText> : data.leave_requests.slice(0, 5).map((item) => (
          <View key={item.id} style={[styles.listRow, { borderColor: colors.divider }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{item.leave_type} · {item.start_date} → {item.end_date}</AppText>
              <AppText variant="caption" numberOfLines={2}>{item.reason}</AppText>
            </View>
            <StatusBadge status={item.status} />
          </View>
        ))}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle icon="navigate-circle-outline" title="Client visits" />
        {data.client_visits.length === 0 ? <AppText variant="caption">No client visits yet.</AppText> : data.client_visits.slice(0, 6).map((item) => (
          <View key={item.id} style={[styles.listRow, { borderColor: colors.divider }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{item.client_name}</AppText>
              <AppText variant="caption">{fmtDateTime(item.scheduled_for)} · {item.site_address}</AppText>
              <StatusBadge status={item.status} />
            </View>
            {item.status === "APPROVED" ? <Button label="Start" size="sm" loading={busy} onPress={() => onVisitAction(item.id, "start")} /> : null}
            {item.status === "IN_PROGRESS" ? <Button label="Complete" size="sm" loading={busy} onPress={() => onVisitAction(item.id, "complete")} /> : null}
          </View>
        ))}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle icon="receipt-outline" title="Expense claims" />
        {data.expense_claims.length === 0 ? <AppText variant="caption">No expense claims yet.</AppText> : data.expense_claims.slice(0, 6).map((item) => (
          <View key={item.id} style={[styles.listRow, { borderColor: colors.divider }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>₹{item.amount.toFixed(2)} · {item.category}</AppText>
              <AppText variant="caption">{item.expense_date} · {item.description}</AppText>
            </View>
            <StatusBadge status={item.status} />
          </View>
        ))}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle icon="time-outline" title="Attendance history" />
        {data.attendance_history.slice(0, 7).map((item) => (
          <View key={item.id} style={styles.historyRow}>
            <AppText style={{ flex: 1, fontFamily: fonts.medium, color: colors.onSurface }}>{item.date}</AppText>
            <AppText variant="caption">{fmtDateTime(item.check_in)} → {fmtDateTime(item.check_out)}</AppText>
          </View>
        ))}
      </Card>
    </View>
  );
}

function OwnerControl({ data, decisionNote, setDecisionNote, busy, onDecision }: {
  data: OwnerData;
  decisionNote: string;
  setDecisionNote: (value: string) => void;
  busy: boolean;
  onDecision: (kind: "leave" | "visits" | "expenses", id: string, action: "APPROVE" | "REJECT") => Promise<void>;
}) {
  const { colors } = useTheme();
  return (
    <>
      <Card style={{ gap: spacing.md }}>
        <SectionTitle icon="people-circle-outline" title="Workforce Control" subtitle="Owner approval and attendance visibility" />
        <View style={styles.metricRow}>
          <Metric label="Present today" value={String(data.attendance.filter((a) => a.check_in).length)} />
          <Metric label="Leave pending" value={String(data.leave_requests.length)} />
          <Metric label="Visits pending" value={String(data.client_visits.length)} />
          <Metric label="Claims" value={String(data.expense_claims.length)} />
        </View>
        <Input label="Decision note" value={decisionNote} onChangeText={setDecisionNote} placeholder="Required for rejection" autoCapitalize="sentences" />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionTitle icon="finger-print-outline" title="Today’s attendance" />
        {data.attendance.length === 0 ? <AppText variant="caption">No staff has punched in yet.</AppText> : data.attendance.map((item) => (
          <View key={item.id} style={[styles.listRow, { borderColor: colors.divider }]}>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{item.user_name || "Staff"}</AppText>
              <AppText variant="caption">{item.role || "staff"}</AppText>
            </View>
            <AppText variant="caption">{fmtDateTime(item.check_in)} → {fmtDateTime(item.check_out)}</AppText>
          </View>
        ))}
      </Card>

      <ApprovalSection title="Leave approvals" icon="calendar-outline" empty="No leave requests waiting." items={data.leave_requests.map((item) => ({
        id: item.id,
        title: `${item.user_name || "Staff"} · ${item.leave_type}`,
        detail: `${item.start_date} → ${item.end_date} · ${item.reason}`,
        status: item.status,
        kind: "leave" as const,
        canApprove: true,
      }))} busy={busy} onDecision={onDecision} />

      <ApprovalSection title="Client visit approvals" icon="navigate-outline" empty="No client visits waiting." items={data.client_visits.map((item) => ({
        id: item.id,
        title: `${item.user_name || "Staff"} · ${item.client_name}`,
        detail: `${fmtDateTime(item.scheduled_for)} · ${item.site_address}`,
        status: item.status,
        kind: "visits" as const,
        canApprove: true,
      }))} busy={busy} onDecision={onDecision} />

      <ApprovalSection title="Expense approvals" icon="wallet-outline" empty="No expense claims waiting." items={data.expense_claims.map((item) => ({
        id: item.id,
        title: `${item.user_name || "Staff"} · ₹${item.amount.toFixed(2)}`,
        detail: `${item.category} · ${item.expense_date} · ${item.description}`,
        status: item.status,
        kind: "expenses" as const,
        canApprove: item.status === "VERIFIED",
      }))} busy={busy} onDecision={onDecision} />
    </>
  );
}

function ApprovalSection({ title, icon, empty, items, busy, onDecision }: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  empty: string;
  items: { id: string; title: string; detail: string; status: string; kind: "leave" | "visits" | "expenses"; canApprove: boolean }[];
  busy: boolean;
  onDecision: (kind: "leave" | "visits" | "expenses", id: string, action: "APPROVE" | "REJECT") => Promise<void>;
}) {
  const { colors } = useTheme();
  return (
    <Card style={{ gap: spacing.md }}>
      <SectionTitle icon={icon} title={title} />
      {items.length === 0 ? <AppText variant="caption">{empty}</AppText> : items.map((item) => (
        <View key={item.id} style={[styles.approval, { borderColor: colors.border }]}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <AppText style={{ flex: 1, fontFamily: fonts.semibold, color: colors.onSurface }}>{item.title}</AppText>
              <StatusBadge status={item.status} />
            </View>
            <AppText variant="caption">{item.detail}</AppText>
            {item.kind === "expenses" && !item.canApprove ? <AppText variant="caption">Awaiting Accountant verification before approval.</AppText> : null}
          </View>
          <View style={styles.decisionRow}>
            {item.canApprove ? <Button label="Approve" size="sm" loading={busy} onPress={() => onDecision(item.kind, item.id, "APPROVE")} /> : null}
            <Button label="Reject" size="sm" variant="outline" loading={busy} onPress={() => onDecision(item.kind, item.id, "REJECT")} />
          </View>
        </View>
      ))}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: colors.surfaceSecondary }]}>
      <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.xl, color: colors.onSurface }}>{value}</AppText>
      <AppText variant="caption" center>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sectionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  attendanceState: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  quickRow: { flexDirection: "row", gap: spacing.sm },
  quick: { flex: 1, minHeight: 88, alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, padding: spacing.sm },
  listRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  reviewRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  actionCol: { gap: spacing.xs },
  metricRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { width: "48%", minHeight: 76, alignItems: "center", justifyContent: "center", borderRadius: radius.md, padding: spacing.sm },
  approval: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  decisionRow: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
