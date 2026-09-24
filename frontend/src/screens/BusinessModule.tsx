import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Plant = { id: string; name: string; city?: string; grades?: string[] };
type FieldDef = { key: string; label: string; placeholder?: string; numeric?: boolean; required?: boolean };
type Row = { id: string; title: string; subtitle?: string; meta?: string; raw?: any };

type ModuleDef = {
  title: string;
  subtitle: string;
  addLabel?: string;
  fields?: FieldDef[];
};

const MODULES: Record<string, ModuleDef> = {
  profile: {
    title: "Plant Profile",
    subtitle: "Legal, GST, banking and document identity",
    addLabel: "Edit Profile",
    fields: [
      { key: "legal_name", label: "Legal name", required: true },
      { key: "trade_name", label: "Trade name" },
      { key: "gstin", label: "GSTIN" },
      { key: "pan", label: "PAN" },
      { key: "billing_address", label: "Billing address", required: true },
      { key: "state", label: "State" },
      { key: "state_code", label: "State code" },
      { key: "contact_phone", label: "Contact phone" },
      { key: "contact_email", label: "Contact email" },
      { key: "bank_name", label: "Bank name" },
      { key: "bank_account_masked", label: "Bank account / masked account" },
      { key: "ifsc", label: "IFSC" },
      { key: "invoice_prefix", label: "Invoice prefix" },
      { key: "challan_prefix", label: "Challan prefix" },
      { key: "quotation_prefix", label: "Quotation prefix" },
      { key: "terms_and_conditions", label: "Terms & conditions" },
    ],
  },
  rates: {
    title: "Rate Cards",
    subtitle: "Plant-specific concrete pricing used by invoices",
    addLabel: "Add Rate",
    fields: [
      { key: "grade", label: "Grade", placeholder: "M25", required: true },
      { key: "rate_per_m3", label: "Rate / m³", numeric: true, required: true },
      { key: "gst_rate", label: "GST %", numeric: true },
      { key: "transport_rate_per_km", label: "Transport / km", numeric: true },
      { key: "pumping_rate_per_m3", label: "Pumping / m³", numeric: true },
      { key: "effective_from", label: "Effective from", placeholder: "2026-08-23", required: true },
    ],
  },
  mixes: {
    title: "Mix Designs",
    subtitle: "Material recipe used for production consumption",
    addLabel: "Add Mix Design",
    fields: [
      { key: "grade", label: "Grade", placeholder: "M25", required: true },
      { key: "version", label: "Version", numeric: true },
      { key: "cement_kg", label: "Cement kg/m³", numeric: true, required: true },
      { key: "fly_ash_kg", label: "Fly ash kg/m³", numeric: true },
      { key: "c_sand_kg", label: "C-Sand kg/m³", numeric: true },
      { key: "sand_kg", label: "Sand kg/m³", numeric: true },
      { key: "aggregate_10mm_kg", label: "10mm kg/m³", numeric: true },
      { key: "aggregate_20mm_kg", label: "20mm kg/m³", numeric: true },
      { key: "admixture_kg", label: "Admixture kg/m³", numeric: true },
      { key: "water_litre", label: "Water litre/m³", numeric: true },
      { key: "target_slump_mm", label: "Target slump mm", numeric: true },
      { key: "notes", label: "Notes" },
    ],
  },
  suppliers: {
    title: "Suppliers",
    subtitle: "Approved material and service vendors",
    addLabel: "Add Supplier",
    fields: [
      { key: "name", label: "Supplier name", required: true },
      { key: "gstin", label: "GSTIN" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
    ],
  },
  quotations: {
    title: "Quotations",
    subtitle: "Customer/site concrete quotations",
    addLabel: "Create Quotation",
    fields: [
      { key: "customer_name", label: "Customer name", required: true },
      { key: "customer_mobile", label: "Customer mobile" },
      { key: "site_name", label: "Site name", required: true },
      { key: "site_address", label: "Site address", required: true },
      { key: "grade", label: "Grade", placeholder: "M25", required: true },
      { key: "quantity_m3", label: "Quantity m³", numeric: true, required: true },
      { key: "rate_per_m3", label: "Rate / m³", numeric: true, required: true },
      { key: "gst_rate", label: "GST %", numeric: true },
      { key: "transport_amount", label: "Transport amount", numeric: true },
      { key: "pumping_amount", label: "Pumping amount", numeric: true },
      { key: "valid_until", label: "Valid until", placeholder: "2026-09-30", required: true },
      { key: "notes", label: "Notes" },
    ],
  },
  expenses: {
    title: "Expenses",
    subtitle: "Plant expense register",
    addLabel: "Add Expense",
    fields: [
      { key: "category", label: "Category", placeholder: "maintenance", required: true },
      { key: "amount", label: "Amount", numeric: true, required: true },
      { key: "expense_date", label: "Expense date", placeholder: "2026-08-23", required: true },
      { key: "vendor", label: "Vendor" },
      { key: "reference", label: "Reference" },
      { key: "payment_method", label: "Payment method", placeholder: "bank_transfer" },
      { key: "notes", label: "Notes" },
    ],
  },
  diesel: {
    title: "Diesel Ledger",
    subtitle: "Diesel receipts, consumption and balance",
    addLabel: "Post Diesel",
    fields: [
      { key: "transaction_type", label: "Type", placeholder: "IN / OUT / ADJUSTMENT", required: true },
      { key: "litres", label: "Litres", numeric: true, required: true },
      { key: "rate_per_litre", label: "Rate / litre", numeric: true },
      { key: "vehicle_id", label: "Vehicle ID (optional)" },
      { key: "supplier_id", label: "Supplier ID (optional)" },
      { key: "odometer_km", label: "Odometer km", numeric: true },
      { key: "reference", label: "Reference" },
      { key: "notes", label: "Notes" },
    ],
  },
  purchases: {
    title: "Purchases",
    subtitle: "Material receipts that automatically increase stock",
    addLabel: "Post Purchase",
    fields: [
      { key: "supplier_id", label: "Supplier ID", required: true },
      { key: "receipt_number", label: "Receipt / invoice no.", required: true },
      { key: "receipt_date", label: "Receipt date", placeholder: "2026-08-23", required: true },
      { key: "material_id", label: "Material ID", required: true },
      { key: "quantity", label: "Quantity", numeric: true, required: true },
      { key: "rate", label: "Rate", numeric: true, required: true },
      { key: "gst_amount", label: "GST amount", numeric: true },
      { key: "freight_amount", label: "Freight amount", numeric: true },
      { key: "notes", label: "Notes" },
    ],
  },
  payroll: {
    title: "Payroll",
    subtitle: "Monthly salary, allowances and deductions",
    addLabel: "Add / Update Payroll",
    fields: [
      { key: "user_id", label: "Staff user ID", required: true },
      { key: "month", label: "Month", placeholder: "2026-08", required: true },
      { key: "basic_amount", label: "Basic amount", numeric: true, required: true },
      { key: "allowances", label: "Allowances", numeric: true },
      { key: "overtime_amount", label: "Overtime", numeric: true },
      { key: "deductions", label: "Deductions", numeric: true },
      { key: "paid_days", label: "Paid days", numeric: true },
      { key: "status", label: "Status", placeholder: "DRAFT / APPROVED / PAID" },
      { key: "notes", label: "Notes" },
    ],
  },
  fleet: {
    title: "Fleet",
    subtitle: "Transit mixers and current availability",
    addLabel: "Add Transit Mixer",
    fields: [
      { key: "tm_number", label: "TM number", required: true },
      { key: "capacity_m3", label: "Capacity m³", numeric: true, required: true },
    ],
  },
  inventory: {
    title: "Inventory",
    subtitle: "Material stock and reorder status",
    addLabel: "Add Material",
    fields: [
      { key: "code", label: "Material code", placeholder: "CEMENT" },
      { key: "name", label: "Material name", required: true },
      { key: "unit", label: "Unit", placeholder: "kg / MT / L", required: true },
      { key: "stock", label: "Opening stock", numeric: true },
      { key: "reorder", label: "Reorder level", numeric: true },
    ],
  },
  attendance: { title: "Attendance", subtitle: "Daily staff attendance register" },
  staff: {
    title: "Plant Staff",
    subtitle: "Owner-managed email OTP accounts. Drivers are managed separately by Plant Admin.",
    addLabel: "Add Plant Staff",
    fields: [
      { key: "name", label: "Full name", required: true },
      { key: "email", label: "Work email", placeholder: "name@company.com", required: true },
      { key: "role", label: "Role", placeholder: "admin / dispatcher / operator / supervisor / accountant / quality_engineer / fleet_manager / store_manager", required: true },
    ],
  },
  customers: { title: "Customers", subtitle: "Customers served by this plant" },
  reports: { title: "Plant Report", subtitle: "Live operational and commercial summary" },
};

const STAFF_ROLE_OPTIONS = [
  { value: "admin", label: "Plant Admin" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "operator", label: "Plant Operator / Batcher" },
  { value: "supervisor", label: "Supervisor" },
  { value: "accountant", label: "Accountant" },
  { value: "quality_engineer", label: "Quality Engineer" },
  { value: "fleet_manager", label: "Fleet Manager" },
  { value: "store_manager", label: "Store Manager" },
];

const numericFields = new Set([
  "rate_per_m3", "gst_rate", "transport_rate_per_km", "pumping_rate_per_m3", "version",
  "cement_kg", "fly_ash_kg", "c_sand_kg", "sand_kg", "aggregate_10mm_kg", "aggregate_20mm_kg",
  "admixture_kg", "water_litre", "target_slump_mm", "quantity_m3", "transport_amount", "pumping_amount",
  "amount", "litres", "rate_per_litre", "odometer_km", "quantity", "rate", "gst_amount", "freight_amount",
  "basic_amount", "allowances", "overtime_amount", "deductions", "paid_days", "capacity_m3", "stock", "reorder",
]);

function today() { return new Date().toISOString().slice(0, 10); }
function monthNow() { return new Date().toISOString().slice(0, 7); }

function dataPath(kind: string, plantId: string) {
  if (kind === "profile") return `/master/plants/${plantId}/profile`;
  if (kind === "rates") return `/master/plants/${plantId}/rate-cards?active_only=false`;
  if (kind === "mixes") return `/master/plants/${plantId}/mix-designs?active_only=false`;
  if (kind === "suppliers") return `/master/plants/${plantId}/suppliers`;
  if (kind === "quotations") return `/ops/plants/${plantId}/quotations`;
  if (kind === "expenses") return `/ops/plants/${plantId}/expenses`;
  if (kind === "diesel") return `/ops/plants/${plantId}/diesel`;
  if (kind === "purchases") return `/ops/plants/${plantId}/purchases`;
  if (kind === "payroll") return `/ops/plants/${plantId}/payroll/${monthNow()}`;
  if (kind === "attendance") return `/ops/plants/${plantId}/attendance/${today()}`;
  if (kind === "staff") return `/master/plants/${plantId}/people`;
  if (kind === "customers") return `/business/plants/${plantId}/customers`;
  if (kind === "reports") return `/master/plants/${plantId}/summary`;
  if (kind === "fleet" || kind === "inventory") return `/master/plants/${plantId}/resources`;
  return `/master/plants/${plantId}/summary`;
}

function unpackRows(kind: string, data: any): Row[] {
  const arr = kind === "rates" ? data?.rate_cards
    : kind === "mixes" ? data?.mix_designs
    : kind === "suppliers" ? data?.suppliers
    : kind === "quotations" ? data?.quotations
    : kind === "expenses" ? data?.expenses
    : kind === "diesel" ? data?.transactions
    : kind === "purchases" ? data?.purchases
    : kind === "payroll" ? data?.payroll
    : kind === "attendance" ? data?.attendance
    : kind === "staff" ? data?.people
    : kind === "customers" ? data?.customers
    : kind === "fleet" ? data?.vehicles
    : kind === "inventory" ? data?.materials
    : [];
  return (arr || []).map((d: any, idx: number) => {
    let row: Row;
    if (kind === "rates") row = { id: d.id, title: `${d.grade} · ₹${d.rate_per_m3}/m³`, subtitle: `GST ${d.gst_rate}% · ${d.active ? "Active" : "Inactive"}`, meta: `From ${d.effective_from}` };
    else if (kind === "mixes") row = { id: d.id, title: `${d.grade} · v${d.version}`, subtitle: `Cement ${d.cement_kg}kg · Fly ash ${d.fly_ash_kg}kg`, meta: `10mm ${d.aggregate_10mm_kg} · 20mm ${d.aggregate_20mm_kg} · Water ${d.water_litre}L` };
    else if (kind === "suppliers") row = { id: d.id, title: d.name, subtitle: d.gstin || d.phone || "Supplier", meta: d.email || d.address };
    else if (kind === "quotations") row = { id: d.id, title: `${d.quotation_number} · ${d.customer_name}`, subtitle: `${d.grade} · ${d.quantity_m3} m³ · ₹${Math.round(d.total || 0)}`, meta: `${d.site_name} · valid ${d.valid_until}` };
    else if (kind === "expenses") row = { id: d.id, title: `${d.category} · ₹${d.amount}`, subtitle: d.vendor || d.payment_method, meta: `${d.expense_date}${d.reference ? ` · ${d.reference}` : ""}` };
    else if (kind === "diesel") row = { id: d.id, title: `${d.transaction_type} · ${d.litres} L`, subtitle: d.vehicle_id ? `Vehicle ${d.vehicle_id}` : (d.reference || "Diesel stock"), meta: d.created_at };
    else if (kind === "purchases") row = { id: d.id, title: `${d.receipt_number} · ${d.supplier_name || "Supplier"}`, subtitle: `₹${Math.round(d.total || 0)} · ${d.status}`, meta: d.receipt_date };
    else if (kind === "payroll") row = { id: d.id, title: d.user_name || d.user_id, subtitle: `${d.month} · ₹${Math.round(d.net_amount || 0)}`, meta: d.status };
    else if (kind === "attendance") row = { id: d.id || `${idx}`, title: d.user_name || "Staff", subtitle: d.check_in ? `In ${String(d.check_in).slice(11, 16)}` : "Not checked in", meta: d.check_out ? `Out ${String(d.check_out).slice(11, 16)}` : "Open" };
    else if (kind === "staff") row = { id: d.id, title: d.name, subtitle: d.role_label || d.role, meta: `${d.phone || d.email || ""}${d.status ? ` · ${d.status}` : ""}` };
    else if (kind === "customers") row = { id: d.id, title: d.name, subtitle: d.phone || d.email || "Customer", meta: `${d.orders || 0} orders · ${d.delivered_m3 || 0} m³ delivered` };
    else if (kind === "fleet") row = { id: d.id, title: d.tm_number, subtitle: `${d.capacity_m3} m³ capacity`, meta: d.status };
    else if (kind === "inventory") row = { id: d.id, title: d.name, subtitle: `${d.stock} ${d.unit}`, meta: `Reorder ≤ ${d.reorder} ${d.unit}${d.code ? ` · ${d.code}` : ""}` };
    else row = { id: d.id || `${idx}`, title: d.name || "Record", subtitle: d.status };
    row.raw = d;
    return row;
  });
}

export function BusinessModule({ kind }: { kind: string }) {
  const def = MODULES[kind] || MODULES.reports;
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [resources, setResources] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [adjustRow, setAdjustRow] = useState<Row | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustSign, setAdjustSign] = useState<1 | -1>(1);

  const loadPlants = useCallback(async () => {
    if (!token) return;
    const result = await apiGet<{ plants: Plant[] }>("/master/my-plants", token);
    setPlants(result.plants);
    setPlantId((old) => old && result.plants.some((p) => p.id === old) ? old : result.plants[0]?.id || null);
  }, [token]);

  const load = useCallback(async () => {
    if (!token || !plantId) return;
    setLoading(true);
    setError(null);
    try {
      const tasks: Promise<any>[] = [
        apiGet<any>(dataPath(kind, plantId), token),
        apiGet<any>(`/master/plants/${plantId}/resources`, token),
      ];
      if (kind === "purchases" || kind === "diesel") tasks.push(apiGet<any>(`/master/plants/${plantId}/suppliers`, token));
      const results = await Promise.all(tasks);
      setData(results[0]);
      setResources({ ...(results[1] || {}), suppliers: results[2]?.suppliers || [] });
    } catch (e: any) {
      setError(e.detail || "Could not load module");
    } finally {
      setLoading(false);
    }
  }, [kind, plantId, token]);

  useEffect(() => { loadPlants().catch((e: any) => setError(e.detail || "Could not load plants")); }, [loadPlants]);
  useEffect(() => { if (plantId) load(); }, [plantId, load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return unpackRows(kind, data).filter((r) => !q || [r.title, r.subtitle, r.meta].some((v) => (v || "").toLowerCase().includes(q)));
  }, [kind, data, query]);

  const openForm = () => {
    const initial: Record<string, string> = {};
    if (kind === "profile" && data?.profile) {
      (def.fields || []).forEach((f) => { initial[f.key] = data.profile[f.key] == null ? "" : String(data.profile[f.key]); });
    }
    if (kind === "rates") { initial.gst_rate = "18"; initial.effective_from = today(); }
    if (kind === "mixes") initial.version = "1";
    if (kind === "expenses") { initial.expense_date = today(); initial.payment_method = "cash"; }
    if (kind === "quotations") { initial.gst_rate = "18"; initial.valid_until = today(); }
    if (kind === "diesel") initial.transaction_type = "IN";
    if (kind === "purchases") {
      initial.receipt_date = today();
      initial.supplier_id = resources?.suppliers?.[0]?.id || "";
      initial.material_id = resources?.materials?.[0]?.id || "";
    }
    if (kind === "payroll") {
      initial.month = monthNow(); initial.status = "DRAFT";
      initial.user_id = resources?.people?.[0]?.id || "";
    }
    setForm(initial);
    setModal(true);
  };

  const submit = async () => {
    if (!token || !plantId) return;
    for (const f of def.fields || []) {
      if (f.required && !String(form[f.key] || "").trim()) return toast(`${f.label} is required`, "error");
    }
    const payload: any = {};
    for (const f of def.fields || []) {
      const raw = String(form[f.key] || "").trim();
      if (!raw) continue;
      payload[f.key] = numericFields.has(f.key) ? Number(raw) : raw;
    }
    setSaving(true);
    try {
      if (kind === "profile") {
        payload.invoice_prefix ||= "INV"; payload.challan_prefix ||= "CH"; payload.quotation_prefix ||= "QT";
        await apiPut(`/master/plants/${plantId}/profile`, token, payload);
      } else if (kind === "rates") {
        payload.gst_rate ??= 18; payload.transport_rate_per_km ??= 0; payload.pumping_rate_per_m3 ??= 0; payload.active = true;
        await apiPost(`/master/plants/${plantId}/rate-cards`, token, payload);
      } else if (kind === "mixes") {
        payload.version ??= 1; payload.fly_ash_kg ??= 0; payload.c_sand_kg ??= 0; payload.sand_kg ??= 0;
        payload.aggregate_10mm_kg ??= 0; payload.aggregate_20mm_kg ??= 0; payload.admixture_kg ??= 0; payload.water_litre ??= 0; payload.active = true;
        await apiPost(`/master/plants/${plantId}/mix-designs`, token, payload);
      } else if (kind === "suppliers") {
        payload.active = true; await apiPost(`/master/plants/${plantId}/suppliers`, token, payload);
      } else if (kind === "quotations") {
        payload.gst_rate ??= 18; payload.transport_amount ??= 0; payload.pumping_amount ??= 0;
        await apiPost(`/ops/plants/${plantId}/quotations`, token, payload);
      } else if (kind === "expenses") {
        payload.payment_method ||= "cash"; await apiPost(`/ops/plants/${plantId}/expenses`, token, payload);
      } else if (kind === "diesel") {
        await apiPost(`/ops/plants/${plantId}/diesel`, token, payload);
      } else if (kind === "purchases") {
        await apiPost(`/ops/plants/${plantId}/purchases`, token, {
          supplier_id: payload.supplier_id,
          receipt_number: payload.receipt_number,
          receipt_date: payload.receipt_date,
          lines: [{ material_id: payload.material_id, quantity: payload.quantity, rate: payload.rate }],
          gst_amount: payload.gst_amount || 0,
          freight_amount: payload.freight_amount || 0,
          notes: payload.notes || null,
        });
      } else if (kind === "payroll") {
        payload.allowances ??= 0; payload.overtime_amount ??= 0; payload.deductions ??= 0; payload.paid_days ??= 0; payload.status ||= "DRAFT";
        await apiPut(`/ops/plants/${plantId}/payroll`, token, payload);
      } else if (kind === "fleet") {
        await apiPost(`/business/plants/${plantId}/vehicles`, token, payload);
      } else if (kind === "inventory") {
        payload.stock ??= 0; payload.reorder ??= 0;
        await apiPost(`/business/plants/${plantId}/materials`, token, payload);
      } else if (kind === "staff") {
        payload.role = String(payload.role || "").trim().toLowerCase().replace(/[ /-]+/g, "_");
        await apiPost(`/business/plants/${plantId}/people`, token, payload);
      }
      toast("Saved", "success");
      setModal(false);
      await load();
    } catch (e: any) {
      toast(e.detail || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const attendanceAction = async (action: "checkin" | "checkout") => {
    if (!token || !plantId) return;
    setSaving(true);
    try {
      await apiPost(`/ops/plants/${plantId}/attendance/${action}`, token, {});
      toast(action === "checkin" ? "Checked in" : "Checked out", "success");
      await load();
    } catch (e: any) { toast(e.detail || "Attendance action failed", "error"); }
    finally { setSaving(false); }
  };

  const toggleFleet = async (row: Row) => {
    if (!token || !plantId) return;
    const current = row.raw?.status;
    const next = current === "maintenance" ? "available" : "maintenance";
    setSaving(true);
    try {
      await apiPost(`/business/plants/${plantId}/vehicles/${row.id}/status`, token, { status: next });
      toast(`Mixer set ${next}`, "success");
      await load();
    } catch (e: any) { toast(e.detail || "Vehicle update failed", "error"); }
    finally { setSaving(false); }
  };

  const toggleStaff = async (row: Row) => {
    if (!token || !plantId) return;
    const active = (row.raw?.status || "active") === "active";
    setSaving(true);
    try {
      await apiPost(`/business/plants/${plantId}/people/${row.id}/${active ? "suspend" : "activate"}`, token);
      toast(active ? "Staff suspended" : "Staff activated", "success");
      await load();
    } catch (e: any) { toast(e.detail || "Staff update failed", "error"); }
    finally { setSaving(false); }
  };

  const openAdjustment = (row: Row, sign: 1 | -1) => {
    setAdjustRow(row); setAdjustSign(sign); setAdjustAmount(""); setAdjustNote("");
  };

  const submitAdjustment = async () => {
    if (!token || !plantId || !adjustRow) return;
    const amount = Number(adjustAmount);
    if (!amount || amount <= 0) return toast("Enter a valid quantity", "error");
    setSaving(true);
    try {
      await apiPost(`/business/plants/${plantId}/materials/${adjustRow.id}/adjust`, token, { delta: amount * adjustSign, note: adjustNote || null });
      toast("Stock updated", "success");
      setAdjustRow(null);
      await load();
    } catch (e: any) { toast(e.detail || "Stock update failed", "error"); }
    finally { setSaving(false); }
  };

  const report = kind === "reports" ? data : null;
  const profile = kind === "profile" ? data?.profile : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brand} />}
      >
        <View style={{ gap: 3 }}>
          <AppText variant="title">{def.title}</AppText>
          <AppText variant="caption">{def.subtitle}</AppText>
        </View>

        {plants.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {plants.map((p) => {
              const selected = plantId === p.id;
              return (
                <Pressable key={p.id} onPress={() => setPlantId(p.id)} style={[styles.chip, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}>
                  <AppText style={{ color: selected ? colors.onBrand : colors.onSurface, fontFamily: fonts.semibold, fontSize: 12 }}>{p.name}</AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {!plantId && !loading ? <Card><AppText variant="bodyMuted">No plant is assigned to this account.</AppText></Card> : null}
        {error ? <Card><AppText style={{ color: colors.error }}>{error}</AppText><Button label="Retry" onPress={load} /></Card> : null}

        {loading ? (
          <><Skeleton height={82} style={{ borderRadius: radius.lg }} /><Skeleton height={82} style={{ borderRadius: radius.lg }} /></>
        ) : kind === "reports" && report ? (
          <View style={styles.grid}>
            {[
              ["Orders", report.orders], ["Active", report.active_orders], ["Delivered m³", report.delivered_m3],
              ["Billed ₹", report.billed], ["Outstanding ₹", report.outstanding], ["Low stock", report.low_stock],
              ["Fleet", report.fleet], ["Available TMs", report.available_mixers],
            ].map(([label, value]) => (
              <Card key={String(label)} style={styles.stat}><AppText variant="caption">{label}</AppText><AppText variant="heading">{String(value ?? 0)}</AppText></Card>
            ))}
          </View>
        ) : kind === "profile" ? (
          <Card style={{ gap: spacing.sm }}>
            {profile ? Object.entries(profile).filter(([k]) => !["id", "plant_id", "created_at", "updated_at", "updated_by"].includes(k)).map(([k, v]) => (
              <View key={k} style={{ gap: 2 }}><AppText variant="caption">{k.replace(/_/g, " ").toUpperCase()}</AppText><AppText>{String(v ?? "—")}</AppText></View>
            )) : <AppText variant="bodyMuted">Plant business profile is not configured yet.</AppText>}
          </Card>
        ) : (
          <>
            {rows.length >= 4 ? (
              <View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search…" placeholderTextColor={colors.onSurfaceTertiary} style={{ flex: 1, color: colors.onSurface, fontFamily: fonts.regular }} />
              </View>
            ) : null}
            {rows.length ? rows.map((r) => (
              <Card key={r.id} style={{ gap: spacing.sm }}>
                <View style={{ gap: 4 }}>
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{r.title}</AppText>
                  {r.subtitle ? <AppText variant="caption">{r.subtitle}</AppText> : null}
                  {r.meta ? <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>{r.meta}</AppText> : null}
                </View>
                {kind === "fleet" && ["available", "maintenance"].includes(r.raw?.status) ? (
                  <Button label={r.raw?.status === "maintenance" ? "Set Available" : "Set Maintenance"} variant="outline" onPress={() => toggleFleet(r)} />
                ) : null}
                {kind === "inventory" ? (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Button label="Stock In" onPress={() => openAdjustment(r, 1)} /></View>
                    <View style={{ flex: 1 }}><Button label="Stock Out" variant="outline" onPress={() => openAdjustment(r, -1)} /></View>
                  </View>
                ) : null}
                {kind === "staff" && STAFF_ROLE_OPTIONS.some((option) => option.value === r.raw?.role) ? (
                  <Button label={(r.raw?.status || "active") === "active" ? "Suspend" : "Activate"} variant="outline" onPress={() => toggleStaff(r)} />
                ) : null}
              </Card>
            )) : <Card><AppText variant="bodyMuted">No records yet.</AppText></Card>}
          </>
        )}

        {kind === "attendance" ? (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Button label="Check In" onPress={() => attendanceAction("checkin")} loading={saving} /></View>
            <View style={{ flex: 1 }}><Button label="Check Out" variant="outline" onPress={() => attendanceAction("checkout")} /></View>
          </View>
        ) : def.addLabel && plantId ? <Button label={def.addLabel} onPress={openForm} /> : null}

        {(kind === "purchases" || kind === "payroll" || kind === "diesel") && resources ? (
          <Card style={{ gap: spacing.sm }}>
            <AppText variant="label">Reference data</AppText>
            {kind === "purchases" ? <AppText variant="caption">Suppliers: {(resources.suppliers || []).map((x: any) => `${x.name} (${x.id})`).join(" · ") || "Create a supplier first"}</AppText> : null}
            {kind === "purchases" ? <AppText variant="caption">Materials: {(resources.materials || []).map((x: any) => `${x.name} (${x.id})`).join(" · ") || "No materials"}</AppText> : null}
            {kind === "payroll" ? <AppText variant="caption">Staff: {(resources.people || []).map((x: any) => `${x.name} (${x.id})`).join(" · ") || "No plant staff"}</AppText> : null}
            {kind === "diesel" ? <AppText variant="caption">Mixers: {(resources.vehicles || []).map((x: any) => `${x.tm_number} (${x.id})`).join(" · ") || "No mixers"}</AppText> : null}
          </Card>
        ) : null}
      </ScrollView>

      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <AppText variant="heading">{def.addLabel}</AppText>
                <Pressable onPress={() => setModal(false)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
              </View>
              {(def.fields || []).map((f) => (
                kind === "staff" && f.key === "role" ? (
                  <View key={f.key} style={{ gap: spacing.sm }}>
                    <AppText variant="label">Role</AppText>
                    <View style={styles.grid}>
                      {STAFF_ROLE_OPTIONS.filter((option) => user?.role === "plant_owner" || option.value !== "admin").map((option) => {
                        const selected = form.role === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            testID={`staff-role-${option.value}`}
                            onPress={() => setForm((current) => ({ ...current, role: option.value }))}
                            style={[styles.roleOption, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}
                          >
                            <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={17} color={selected ? colors.onBrand : colors.onSurfaceSecondary} />
                            <AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm, color: selected ? colors.onBrand : colors.onSurface }}>{option.label}</AppText>
                          </Pressable>
                        );
                      })}
                    </View>
                    <AppText variant="caption">Drivers use a separate mobile OTP and KYC onboarding flow.</AppText>
                  </View>
                ) : (
                  <Input
                    key={f.key}
                    label={f.label}
                    placeholder={f.placeholder}
                    value={form[f.key] || ""}
                    keyboardType={f.numeric ? "numeric" : f.key === "email" ? "email-address" : "default"}
                    autoCapitalize={f.key === "email" ? "none" : undefined}
                    onChangeText={(value) => setForm((old) => ({ ...old, [f.key]: f.numeric ? value.replace(/[^0-9.-]/g, "") : value }))}
                  />
                )
              ))}
              <Button label="Save" onPress={submit} loading={saving} />
              <Button label="Cancel" variant="outline" onPress={() => setModal(false)} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={!!adjustRow} transparent animationType="fade" onRequestClose={() => setAdjustRow(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.adjustSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <AppText variant="heading">{adjustSign > 0 ? "Stock In" : "Stock Out"}</AppText>
            <AppText variant="caption">{adjustRow?.title}</AppText>
            <Input label="Quantity" value={adjustAmount} keyboardType="numeric" onChangeText={(v) => setAdjustAmount(v.replace(/[^0-9.]/g, ""))} />
            <Input label="Reason / note" value={adjustNote} onChangeText={setAdjustNote} />
            <Button label="Confirm" onPress={submitAdjustment} loading={saving} />
            <Button label="Cancel" variant="outline" onPress={() => setAdjustRow(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  roleOption: { width: "48%", minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.md },
  stat: { width: "48%", gap: 4 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
  adjustSheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
});
