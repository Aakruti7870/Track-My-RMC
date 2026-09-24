import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiGet, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Profile = {
  employee_code?: string; designation?: string; department?: string; join_date?: string;
  employment_type?: string; weekly_off_day?: string; work_location?: string | null;
  emergency_contact_name?: string | null; emergency_contact_phone?: string | null;
  document_references?: string[];
};
type Salary = {
  effective_from?: string; pay_basis?: string; basic_amount?: number; hra_amount?: number;
  other_allowances?: number; overtime_rate_per_hour?: number; fixed_deductions?: number;
  employee_pf?: number; employee_esi?: number; professional_tax?: number; tds?: number;
};
type Employee = {
  user_id: string; name: string; role: string; email?: string | null; phone?: string | null;
  profile: Profile | null; current_salary: Salary | null;
  salary_totals: { allowances: number; deductions: number; gross: number; net_before_overtime: number };
};
type HrResponse = { plants: { plant_id: string; employees: Employee[] }[]; can_edit: boolean };

function dateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function money(value: number | undefined) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function EmployeeMasterScreen() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const allowed = user?.role === "plant_owner" || user?.role === "accountant";
  const canEdit = user?.role === "plant_owner";

  const [data, setData] = useState<HrResponse | null>(null);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [employeeCode, setEmployeeCode] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [joinDate, setJoinDate] = useState(dateKey());
  const [employmentType, setEmploymentType] = useState("PERMANENT");
  const [weeklyOff, setWeeklyOff] = useState("SUNDAY");
  const [workLocation, setWorkLocation] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [documentRefs, setDocumentRefs] = useState("");

  const [effectiveFrom, setEffectiveFrom] = useState(dateKey());
  const [payBasis, setPayBasis] = useState("MONTHLY");
  const [basic, setBasic] = useState("0");
  const [hra, setHra] = useState("0");
  const [allowances, setAllowances] = useState("0");
  const [otRate, setOtRate] = useState("0");
  const [fixedDeductions, setFixedDeductions] = useState("0");
  const [pf, setPf] = useState("0");
  const [esi, setEsi] = useState("0");
  const [pt, setPt] = useState("0");
  const [tds, setTds] = useState("0");

  const applyEmployee = (employee: Employee) => {
    setSelected(employee);
    const p = employee.profile || {};
    const s = employee.current_salary || {};
    setEmployeeCode(p.employee_code || ""); setDesignation(p.designation || ""); setDepartment(p.department || "");
    setJoinDate(p.join_date || dateKey()); setEmploymentType(p.employment_type || "PERMANENT"); setWeeklyOff(p.weekly_off_day || "SUNDAY");
    setWorkLocation(p.work_location || ""); setEmergencyName(p.emergency_contact_name || ""); setEmergencyPhone(p.emergency_contact_phone || "");
    setDocumentRefs((p.document_references || []).join(", "));
    setEffectiveFrom(s.effective_from || dateKey()); setPayBasis(s.pay_basis || "MONTHLY"); setBasic(String(s.basic_amount ?? 0));
    setHra(String(s.hra_amount ?? 0)); setAllowances(String(s.other_allowances ?? 0)); setOtRate(String(s.overtime_rate_per_hour ?? 0));
    setFixedDeductions(String(s.fixed_deductions ?? 0)); setPf(String(s.employee_pf ?? 0)); setEsi(String(s.employee_esi ?? 0));
    setPt(String(s.professional_tax ?? 0)); setTds(String(s.tds ?? 0));
  };

  const load = useCallback(async () => {
    if (!token || !allowed) { setLoading(false); return; }
    setLoading(true);
    try {
      const response = await apiGet<HrResponse>("/hr/employees", token);
      setData(response);
      if (selected) {
        const fresh = response.plants.flatMap((p) => p.employees).find((e) => e.user_id === selected.user_id);
        if (fresh) applyEmployee(fresh);
      }
    } catch (error: unknown) {
      toast(apiErrorDetail(error, "Unable to load employee master"), "error");
    } finally { setLoading(false); }
  }, [token, allowed, toast, selected?.user_id]);

  useEffect(() => { load(); }, [token, allowed]);

  const save = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await action(); toast(message, "success"); await load(); }
    catch (error: unknown) { toast(apiErrorDetail(error, "Unable to save employee record"), "error"); }
    finally { setBusy(false); }
  };

  if (!allowed) return <View style={[styles.center, { backgroundColor: colors.surface }]}><AppText variant="heading">Employee master is restricted.</AppText><AppText variant="caption">Plant Owner and Accountant only.</AppText></View>;
  if (loading && !data) return <View style={[styles.center, { backgroundColor: colors.surface }]}><ActivityIndicator color={colors.brand} /></View>;

  const plant = data?.plants?.[0];
  const employees = plant?.employees || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={[styles.iconButton, { borderColor: colors.border }]}><Ionicons name="arrow-back" size={20} color={colors.onSurface} /></Pressable>
          <View style={{ flex: 1 }}><AppText variant="title">Employee Master</AppText><AppText variant="caption">Employment details · Salary structure · HR references</AppText></View>
        </View>

        <Card style={{ gap: spacing.md }}>
          <View style={styles.rowBetween}><AppText variant="heading">Plant Employees</AppText><Badge label={canEdit ? "OWNER EDIT" : "READ ONLY"} color={canEdit ? colors.brand : colors.warning} /></View>
          <View style={styles.wrap}>{employees.map((employee) => (
            <Pressable key={employee.user_id} onPress={() => applyEmployee(employee)} style={[styles.chip, { borderColor: selected?.user_id === employee.user_id ? colors.brand : colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <AppText style={{ fontFamily: fonts.semibold }}>{employee.name}</AppText><AppText variant="caption">{employee.role.replaceAll("_", " ")}</AppText>
            </Pressable>
          ))}</View>
          {employees.length === 0 ? <AppText variant="caption">No staff assigned to this plant.</AppText> : null}
        </Card>

        {selected && plant ? <>
          <Card style={{ gap: spacing.md }}>
            <View style={styles.rowBetween}><View><AppText variant="heading">{selected.name}</AppText><AppText variant="caption">{selected.email || selected.phone || selected.role}</AppText></View><Badge label={selected.role.toUpperCase()} color={colors.brand} /></View>
            <Input label="Employee code" value={employeeCode} onChangeText={setEmployeeCode} editable={canEdit} placeholder="EMP-001" />
            <Input label="Designation" value={designation} onChangeText={setDesignation} editable={canEdit} placeholder="Plant Supervisor" />
            <Input label="Department" value={department} onChangeText={setDepartment} editable={canEdit} placeholder="Operations" />
            <Input label="Join date (YYYY-MM-DD)" value={joinDate} onChangeText={setJoinDate} editable={canEdit} />
            <Input label="Employment type" value={employmentType} onChangeText={setEmploymentType} editable={canEdit} placeholder="PERMANENT" />
            <Input label="Weekly off" value={weeklyOff} onChangeText={setWeeklyOff} editable={canEdit} placeholder="SUNDAY" />
            <Input label="Work location" value={workLocation} onChangeText={setWorkLocation} editable={canEdit} />
            <Input label="Emergency contact name" value={emergencyName} onChangeText={setEmergencyName} editable={canEdit} />
            <Input label="Emergency contact phone" value={emergencyPhone} onChangeText={setEmergencyPhone} editable={canEdit} keyboardType="phone-pad" />
            <Input label="HR document references" value={documentRefs} onChangeText={setDocumentRefs} editable={canEdit} placeholder="Appointment Letter, Licence" />
            {canEdit ? <Button label="Save Employee Profile" loading={busy} onPress={() => save(() => apiPut(`/hr/plants/${plant.plant_id}/employees/${selected.user_id}/profile`, token!, {
              employee_code: employeeCode.trim(), designation: designation.trim(), department: department.trim(), join_date: joinDate,
              employment_type: employmentType.trim().toUpperCase(), weekly_off_day: weeklyOff.trim().toUpperCase(), work_location: workLocation.trim() || null,
              emergency_contact_name: emergencyName.trim() || null, emergency_contact_phone: emergencyPhone.trim() || null, address: null,
              pan_masked: null, uan_masked: null, bank_account_masked: null, bank_name: null, ifsc: null,
              document_references: documentRefs.split(",").map((value) => value.trim()).filter(Boolean), notes: null,
            }), "Employee profile saved")} /> : null}
          </Card>

          <Card style={{ gap: spacing.md }}>
            <AppText variant="heading">Salary Structure</AppText>
            <AppText variant="caption">Reference only. Attendance does not automatically deduct salary; Accountant reviews payroll and Owner still approves it.</AppText>
            <Input label="Effective from" value={effectiveFrom} onChangeText={setEffectiveFrom} editable={canEdit} />
            <Input label="Pay basis" value={payBasis} onChangeText={setPayBasis} editable={canEdit} placeholder="MONTHLY / DAILY" />
            <Input label="Basic amount" value={basic} onChangeText={setBasic} editable={canEdit} keyboardType="decimal-pad" />
            <Input label="HRA" value={hra} onChangeText={setHra} editable={canEdit} keyboardType="decimal-pad" />
            <Input label="Other allowances" value={allowances} onChangeText={setAllowances} editable={canEdit} keyboardType="decimal-pad" />
            <Input label="Overtime rate / hour" value={otRate} onChangeText={setOtRate} editable={canEdit} keyboardType="decimal-pad" />
            <Input label="Other fixed deductions" value={fixedDeductions} onChangeText={setFixedDeductions} editable={canEdit} keyboardType="decimal-pad" />
            <Input label="Employee PF" value={pf} onChangeText={setPf} editable={canEdit} keyboardType="decimal-pad" />
            <Input label="Employee ESI" value={esi} onChangeText={setEsi} editable={canEdit} keyboardType="decimal-pad" />
            <Input label="Professional tax" value={pt} onChangeText={setPt} editable={canEdit} keyboardType="decimal-pad" />
            <Input label="TDS" value={tds} onChangeText={setTds} editable={canEdit} keyboardType="decimal-pad" />
            <View style={styles.metrics}><View><AppText variant="caption">Gross</AppText><AppText variant="heading">{money(selected.salary_totals?.gross)}</AppText></View><View><AppText variant="caption">Deductions</AppText><AppText variant="heading">{money(selected.salary_totals?.deductions)}</AppText></View><View><AppText variant="caption">Net before OT</AppText><AppText variant="heading">{money(selected.salary_totals?.net_before_overtime)}</AppText></View></View>
            {canEdit ? <Button label="Save Salary Structure" loading={busy} onPress={() => save(() => apiPut(`/hr/plants/${plant.plant_id}/employees/${selected.user_id}/salary`, token!, {
              effective_from: effectiveFrom, pay_basis: payBasis.trim().toUpperCase(), basic_amount: Number(basic || 0), hra_amount: Number(hra || 0),
              other_allowances: Number(allowances || 0), overtime_rate_per_hour: Number(otRate || 0), fixed_deductions: Number(fixedDeductions || 0),
              employee_pf: Number(pf || 0), employee_esi: Number(esi || 0), professional_tax: Number(pt || 0), tds: Number(tds || 0), notes: null,
            }), "Salary structure saved")} /> : null}
          </Card>
        </> : <Card><AppText variant="caption">Select an employee to view the profile and salary structure.</AppText></Card>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconButton: { width: 42, height: 42, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minWidth: 145, maxWidth: "100%", borderRadius: radius.md, borderWidth: 1, padding: spacing.md, gap: 2 },
  metrics: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.md },
});
