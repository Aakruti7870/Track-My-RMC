import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Share, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { apiGet, apiPost, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { roleSlotStatus, type PlantJobRole, type PlantRoleAssignment } from "@/src/domain/staffRoleCapacity";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing, operationalStatus, type OperationalStatus } from "@/src/theme/tokens";
import { MODULE_CATALOG } from "@/src/navigation/moduleCatalog";
import { VectorSymbol } from "@/src/components/VectorSymbol";
import { Badge } from "@/src/components/ui/Badge";

type Plant = { id: string; name: string; city?: string; grades?: string[] };
type FieldDef = { key: string; label: string; placeholder?: string; numeric?: boolean; required?: boolean };
type Row = { id: string; title: string; subtitle?: string; meta?: string; raw?: any; stockStatus?: { label: string; status: string } };

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
      { key: "unit", label: "Purchase unit (optional)", placeholder: "Inventory unit by default" },
      { key: "quantity", label: "Quantity (purchase unit)", numeric: true, required: true },
      { key: "rate", label: "Rate per purchase unit (₹)", numeric: true, required: true },
      { key: "gst_amount", label: "GST amount", numeric: true },
      { key: "freight_amount", label: "Freight amount", numeric: true },
      { key: "notes", label: "Notes" },
    ],
  },
  fleet: {
    title: "Fleet",
    subtitle: "Transit mixers and current availability",
    addLabel: "Add Transit Mixer",
    fields: [
      { key: "registration_number", label: "TM number", required: true },
      { key: "capacity_m3", label: "Capacity m³", numeric: true, required: true },
    ],
  },
  inventory: {
    title: "Inventory",
    subtitle: "Material stock and reorder status",
    addLabel: "Add Material",
    fields: [
      { key: "material_type", label: "Material type", placeholder: "CEMENT", required: true },
      { key: "name", label: "Material name", required: true },
      { key: "unit", label: "Unit", placeholder: "kg / MT / L", required: true },
      { key: "current_stock", label: "Opening stock", numeric: true },
      { key: "minimum_stock", label: "Reorder level", numeric: true },
    ],
  },
  attendance: { title: "Attendance", subtitle: "Daily staff attendance register" },
  staff: {
    title: "Plant Staff",
    subtitle: "Register work email, reserve a role and require email verification plus MFA.",
    addLabel: "Invite Plant Staff",
    fields: [
      { key: "email", label: "Registered work email", required: true },
      { key: "full_name", label: "Employee name", required: true },
      { key: "reason", label: "Invitation reason", required: true },
      { key: "role", label: "Role", placeholder: "dispatcher / operator / supervisor / accountant / quality_engineer / fleet_manager / store_manager", required: true },
    ],
  },
  customers: { title: "Customers", subtitle: "Customers served by this plant" },
  reports: { title: "Plant Report", subtitle: "Live operational and commercial summary" },
};

const STAFF_ROLE_OPTIONS = [
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
  "basic_amount", "allowances", "overtime_amount", "deductions", "paid_days", "capacity_m3", "current_stock", "minimum_stock",
]);

const attendanceTime = (value: string) =>
  new Date(value).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

function today() { return new Date().toISOString().slice(0, 10); }

function dataPath(kind: string, plantId: string) {
  if (kind === "profile") return `/master/plants/${plantId}/profile`;
  if (kind === "rates") return `/master/plants/${plantId}/rate-cards?active_only=false`;
  if (kind === "mixes") return `/master/plants/${plantId}/mix-designs?active_only=false`;
  if (kind === "suppliers") return `/master/plants/${plantId}/suppliers`;
  if (kind === "quotations") return `/ops/plants/${plantId}/quotations`;
  if (kind === "expenses") return `/ops/plants/${plantId}/expenses`;
  if (kind === "diesel") return `/ops/plants/${plantId}/diesel`;
  if (kind === "purchases") return `/ops/plants/${plantId}/purchases`;
  if (kind === "attendance") return `/workforce/roster?plant_id=${plantId}`;
  if (kind === "staff") return `/master/plants/${plantId}/people`;
  if (kind === "customers") return `/business/plants/${plantId}/customers`;
  if (kind === "reports") return `/master/plants/${plantId}/summary`;
  if (kind === "fleet") return `/business/plants/${plantId}/vehicles`;
  if (kind === "inventory") return `/business/plants/${plantId}/materials`;
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
    : kind === "attendance" ? data?.roster
    : kind === "staff" ? data?.people
    : kind === "customers" ? data?.customers
    : kind === "fleet" ? data?.vehicles
    : kind === "inventory" ? data?.materials
    : kind === "reports" ? data?.reports
    : [];
  return (arr || []).map((d: any, idx: number) => {
    let row: Row;
    if (kind === "rates") row = { id: d.id, title: `${d.grade} · ₹${d.rate_per_m3}/m³`, subtitle: `GST ${d.gst_rate}% · ${d.active ? "Active" : "Inactive"}`, meta: `From ${d.effective_from}` };
    else if (kind === "mixes") row = { id: d.id, title: `${d.grade} · v${d.version}`, subtitle: `Cement ${d.cement_kg}kg · Fly ash ${d.fly_ash_kg}kg`, meta: `10mm ${d.aggregate_10mm_kg} · 20mm ${d.aggregate_20mm_kg} · Water ${d.water_litre}L` };
    else if (kind === "suppliers") row = { id: d.id, title: d.name, subtitle: d.gstin || d.phone || "Supplier", meta: d.email || d.address };
    else if (kind === "quotations") row = { id: d.id, title: `${d.quotation_number} · ${d.customer_name}`, subtitle: `${d.grade} · ${d.quantity_m3} m³ · ₹${Math.round(d.total || 0)}`, meta: `${d.site_name} · valid ${d.valid_until}` };
    else if (kind === "expenses") row = { id: d.id, title: `${d.category} · ₹${d.amount}`, subtitle: d.vendor || d.payment_method, meta: `${d.expense_date}${d.reference ? ` · ${d.reference}` : ""}` };
    else if (kind === "diesel") row = { id: d.id, title: `${d.transaction_type} · ${d.litres} L`, subtitle: d.vehicle_id ? `Vehicle ${d.vehicle_id}` : (d.reference || "Diesel stock"), meta: d.created_at };
    else if (kind === "purchases") row = { id: d.id, title: `${d.receipt_number} · ${d.supplier_name || "Supplier"}`, subtitle: `₹${Math.round(d.total_amount ?? d.total ?? 0)}${d.status ? ` · ${d.status}` : ""}`, meta: d.receipt_date };
    else if (kind === "attendance") row = { id: d.id || `${idx}`, title: d.user_name || "Staff", subtitle: d.check_in_time ? `In ${attendanceTime(d.check_in_time)}` : "Not checked in", meta: d.check_out_time ? `Out ${attendanceTime(d.check_out_time)}` : "Open" };
    else if (kind === "staff") row = { id: d.id, title: d.name, subtitle: d.role_label || d.role, meta: `${d.phone || d.email || ""}${d.status ? ` · ${d.status}` : ""}` };
    else if (kind === "customers") row = { id: d.id, title: d.name, subtitle: d.phone || d.email || "Customer", meta: `${d.orders || 0} orders · ${d.delivered_m3 || 0} m³ delivered` };
    else if (kind === "fleet") row = { id: d.id, title: d.registration_number || d.tm_number, subtitle: `${d.capacity_m3} m³ capacity`, meta: d.status };
    else if (kind === "inventory") {
      const stock = d.current_stock ?? d.stock;
      const minimum = d.minimum_stock ?? d.reorder;
      const stockStatus = Number(stock) <= 0 ? { label: "Out of stock", status: "OUT_OF_STOCK" }
        : Number(stock) <= Number(minimum) ? { label: "Low stock", status: "LOW_STOCK" }
          : { label: "In stock", status: "IN_STOCK" };
      row = { id: d.id, title: d.name, subtitle: `${stock} ${d.unit}`, meta: `Reorder ≤ ${minimum} ${d.unit}`, stockStatus };
    }
    else row = { id: d.id || `${idx}`, title: d.name || "Record", subtitle: d.status };
    row.raw = d;
    return row;
  });
}

const MATERIAL_VIEWS: Readonly<Record<string, { title: string; matches: RegExp }>> = {
  aggregate: { title: "Aggregates & Sand", matches: /aggregate|sand|stone|gravel|crusher dust/ },
  cement: { title: "Cement", matches: /\b(cement|opc|ppc|psc)\b/ },
  "fly-ash": { title: "Fly Ash / GGBS", matches: /fly\s*ash|ggb(?:f)?s|blast furnace slag/ },
  admixture: { title: "Admixtures / Silica Fume", matches: /admixture|silica fume|micro *silica|plasticizer|retarder/ },
  water: { title: "Water / Ice", matches: /\b(water|ice)\b/ },
};

export function BusinessModule({ kind, preferredPlant, material }: { kind: string; preferredPlant?: string; material?: string }) {
  const materialView = kind === "inventory" && material && Object.hasOwn(MATERIAL_VIEWS, material) ? MATERIAL_VIEWS[material] : undefined;
  const def = MODULES[kind] || MODULES.reports;
  const { token, user } = useAuth();
  const { colors, reduceMotion } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantId, setPlantId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const [data, setData] = useState<any>(null);
  const [resources, setResources] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [adjustRow, setAdjustRow] = useState<Row | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustSign, setAdjustSign] = useState<1 | -1>(1);
  const [permissions, setPermissions] = useState<Record<string, { edit: boolean; create: boolean; export: boolean }>>({});
  const [staffHistory, setStaffHistory] = useState<{events:any[];slots:any[]}>({events:[],slots:[]});
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [managerPolicy,setManagerPolicy]=useState({can_manage_staff:true,can_manage_permissions:false,can_manage_fleet:false,can_manage_drivers:false});
  const isPlantOwner = user?.role === "plant_owner" || user?.role === "owner";
  const [managerEnabled, setManagerEnabled] = useState(false);
  const [managerFleet,setManagerFleet]=useState(false);
  React.useEffect(() => {
    if (isPlantOwner || !token) {
      setManagerEnabled(false);
      setManagerFleet(false);
      return;
    }
    let live = true;
    apiGet<{enabled:boolean;can_manage_staff?:boolean;can_manage_fleet?:boolean}>("/staff/manager-access", token)
      .then(result => { if (live) {setManagerEnabled(result.enabled === true && result.can_manage_staff===true);setManagerFleet(result.enabled && result.can_manage_fleet===true);} })
      .catch(() => {
        if (live) {
          setManagerEnabled(false);
          setManagerFleet(false);
        }
      });
    return () => { live = false; };
  }, [kind, isPlantOwner, token]);
  const canManageStaff = isPlantOwner || managerEnabled;
  const isDelegatedStaff = !!user?.role && ["admin","dispatcher","operator","supervisor","accountant",
    "quality_engineer","fleet_manager","store_manager"].includes(user.role);
  React.useEffect(() => {
    setPermissions({});
    if (!isDelegatedStaff || !token) return;
    let active = true;
    apiGet<{ permissions: Array<{ key: string; edit: boolean; create: boolean; export: boolean }> }>("/staff/module-permissions", token)
      .then(result => {
        if (active) setPermissions(Object.fromEntries(result.permissions.map(item => [item.key, item])));
      }).catch(() => { if (active) setPermissions({}); });
    return () => { active = false; };
  }, [token, isDelegatedStaff]);
  const kindGrant: Record<string, string> = {
    mixes: "mix_designs", inventory: "material_inventory", fleet: "fleet_availability",
    rates: "rate_cards", quotations: "quotations", expenses: "expenses",
    purchases: "purchases", diesel: "diesel_ledger", suppliers: "suppliers",
  };
  const modulePermission = permissions[kindGrant[kind]];
  const canEditModule = kind === "staff" ? canManageStaff : kind === "fleet" && managerFleet ? true :
    (!isDelegatedStaff || !kindGrant[kind] || modulePermission?.edit === true);
  const canCreateModule = kind === "inventory" ? isPlantOwner || modulePermission?.create === true
    : kind === "fleet" ? isPlantOwner || (user?.role === "fleet_manager" ? modulePermission?.create === true : managerFleet)
      : canEditModule;

  const loadPlants = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<{ plants: Plant[] }>("/master/my-plants", token);
      setPlants(result.plants);
      const initial = preferredPlant ? result.plants.find(p => p.id === preferredPlant) : result.plants[0];
      setPlantId(old => result.plants.find(p => p.id === old)?.id ?? initial?.id ?? null);
      if (!initial) {
        setLoading(false);
        if (preferredPlant) setError("The selected plant is unavailable to this account.");
      }
    } catch (e: any) {
      setError(e.detail || "Could not load plants");
      setLoading(false);
    }
  }, [preferredPlant, token]);

  const load = useCallback(async () => {
    if (!token || !plantId) return;
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const tasks: Promise<any>[] = [
        apiGet<any>(dataPath(kind, plantId), token),
        apiGet<any>(`/master/plants/${plantId}/resources`, token),
      ];
      if ((kind === "purchases" || kind === "diesel") && canEditModule) {
        tasks.push(apiGet<any>(`/master/plants/${plantId}/suppliers`, token).catch(() => null));
      }
      const results = await Promise.all(tasks);
      const history = kind === "staff" ? await apiGet<{ events: any[]; slots: any[] }>(`/business/plants/${plantId}/staff/history`, token) : null;
      if (version !== loadVersion.current) return;
      if (history) setStaffHistory(history);
      setData(results[0]);
      setResources({ ...(results[1]?.resources ?? results[1] ?? {}), suppliers: results[2]?.suppliers || [] });
    } catch (e: any) {
      if (version === loadVersion.current) setError(e.detail || "Could not load module");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [canEditModule, kind, plantId, token]);

  const reloadWorkspace = async () => {
    setRefreshing(true);
    try {
      await (plantId ? load() : loadPlants());
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { void loadPlants(); }, [loadPlants]);
  useEffect(() => { if (plantId) load(); }, [plantId, load]);

  const staffAssignments = useMemo<PlantRoleAssignment[]>(
    () => (data?.people || []).map((person: any) => ({
      user_id: String(person.id), role: String(person.role),
      is_active: person.active === true,
      status:person.status,
      removed_at: person.removed_at ?? null,
    })),
    [data?.people],
  );
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  const moduleRows = useMemo(() => unpackRows(kind, data), [kind, data]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return moduleRows.filter(row => {
      const materialText = [row.raw?.material_type ?? row.raw?.type, row.title].join(" ").toLowerCase().replace(/[_/-]/g, " ");
      return (!materialView || materialView.matches.test(materialText))
        && (!q || [row.title, row.subtitle, row.meta].some(value => (value || "").toLowerCase().includes(q)));
    });
  }, [materialView, moduleRows, query]);

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
        const { quantity, rate } = payload;
        const gst = payload.gst_amount ?? 0;
        const freight = payload.freight_amount ?? 0;
        const total = quantity * rate + gst + freight;
        if (![quantity, rate, gst, freight, total].every(Number.isFinite)
          || quantity <= 0 || rate < 0 || gst < 0 || freight < 0) {
          throw { detail: "Enter a positive quantity and valid non-negative receipt amounts." };
        }
        const material = resources?.materials?.find((item: { id: string }) => item.id === payload.material_id);
        const unit = payload.unit || material?.unit;
        if (!unit) throw { detail: "Enter the purchase unit for this material." };
        await apiPost(`/ops/plants/${plantId}/purchases`, token, {
          supplier_id: payload.supplier_id,
          receipt_number: payload.receipt_number,
          receipt_date: payload.receipt_date,
          lines: [{ material_id: payload.material_id, quantity, rate, unit }],
          gst_amount: gst,
          freight_amount: freight,
          // PostgreSQL applies the receipt column's two-decimal rounding.
          total_amount: total,
          notes: payload.notes || null,
        });
      } else if (kind === "fleet") {
        await apiPost(`/business/plants/${plantId}/vehicles`, token, payload);
      } else if (kind === "inventory") {
        await apiPost(`/business/plants/${plantId}/materials`, token, payload);
      } else if (kind === "staff") {
        payload.role = String(payload.role || "").trim().toLowerCase().replace(/[ /-]+/g, "_");
        if (roleSlotStatus(staffAssignments, payload.role as PlantJobRole) !== "available") {
          throw { detail: "This role is already assigned. Remove the previous employee first." };
        }
        await apiPost(`/business/plants/${plantId}/staff/invitations`, token, payload);
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
      await apiPost("/workforce/attendance/mark", token, {
        plant_id: plantId,
        check_type: action === "checkin" ? "in" : "out",
      });
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
    const active = row.raw?.active === true;
    setSaving(true);
    try {
      await apiPost(`/business/plants/${plantId}/staff/${row.id}/lifecycle`, token,{action:active?"suspend":"reactivate",reason:lifecycleReason});
      toast(active ? "Staff suspended" : "Staff activated", "success");
      await load();
    } catch (e: any) { toast(e.detail || "Staff update failed", "error"); }
    finally { setSaving(false); }
  };

  const toggleManager = async (row: Row) => {
    if (!token || !plantId || !isPlantOwner) return;
    setSaving(true);
    try {
      const action = row.raw?.is_manager ? "revoke" : "grant";
      const current=action==="grant" && managerPolicy.can_manage_permissions
        ? await apiGet<{permissions:any[]}>(`/owner/plants/${plantId}/staff/${row.id}/module-permissions`,token) : {permissions:[]};
      const limits=Object.fromEntries(current.permissions.map(g=>[g.key,{view:g.view,create:g.create,edit:g.edit,approve:false,export:g.export}]));
      await apiPost(`/business/plants/${plantId}/staff/${row.id}/manager/${action}`, token,action==="grant"?{...managerPolicy,permission_limits:limits}:{});
      toast(action === "grant" ? "Plant Manager delegated" : "Manager delegation revoked", "success");
      await load();
    } catch (e: any) {
      toast(e.detail || "Manager delegation failed", "error");
    } finally { setSaving(false); }
  };

  const changeStaff = async (row:Row,action:string) => {
    if (!token || !plantId) return;
    if (lifecycleReason.trim().length<10) return toast("Enter a reason of at least 10 characters", "error");
    setSaving(true);
    try {
      await apiPost(`/business/plants/${plantId}/staff/${row.id}/lifecycle`,token,{action,reason:lifecycleReason});
      setLifecycleReason(""); await load(); toast("Employee status updated and audited","success");
    } catch(e:any){toast(e.detail || "Employee update failed","error");} finally {setSaving(false);}
  };

  const removeStaff = async (row: Row) => {
    if (!token || !plantId) return;
    setSaving(true);
    try {
      await apiPost(`/business/plants/${plantId}/staff/${row.id}/lifecycle`, token,{action:"remove",reason:lifecycleReason});
      setRemoveConfirmId(null);
      toast("Employee assignment removed; job role is now available", "success");
      await load();
    } catch (error: any) {
      toast(error.detail || "Unable to remove employee assignment", "error");
    } finally { setSaving(false); }
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
      await apiPost(`/business/plants/${plantId}/materials/${adjustRow.id}/adjust`, token, { quantity_change: amount * adjustSign, reason: adjustNote });
      toast("Stock updated", "success");
      setAdjustRow(null);
      await load();
    } catch (e: any) { toast(e.detail || "Stock update failed", "error"); }
    finally { setSaving(false); }
  };

  const moduleSymbol = MODULE_CATALOG.find(module => module.route === `/business/${kind}`)?.symbol;
  const report = kind === "reports" ? data : null;
  const profile = kind === "profile" ? data?.profile : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reloadWorkspace()} tintColor={colors.brand} />}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {moduleSymbol ? <VectorSymbol name={moduleSymbol} size={40} /> : null}
          <View style={{ flex: 1, gap: 3 }}>
            <AppText variant="title">{materialView?.title ?? def.title}</AppText>
            <AppText variant="caption">{def.subtitle}</AppText>
          </View>
        </View>
        {kind === "staff" && (user?.role === "plant_owner" || user?.role === "owner") ? (
          <Button label="Onboard / Manage Drivers" variant="outline" onPress={() => router.push("/owner/drivers")} />
        ) : null}
        {kind === "staff" && canManageStaff ? <Card style={{gap:spacing.sm}}>
          <AppText variant="label">Seven employee role slots</AppText>
          {staffHistory.slots.map(slot=><AppText key={slot.role} variant="caption">{slot.role.replace(/_/g," ")} · {slot.status} · {slot.email || "Available"}</AppText>)}
          <TextInput accessibilityLabel="Employee change reason" placeholder="Reason for suspension, termination or removal (10–500 characters)" maxLength={500}
            value={lifecycleReason} onChangeText={setLifecycleReason} style={{color:colors.onSurface,padding:10,borderWidth:1,borderColor:colors.border}} />
          <Button label="Configure employee module permissions" variant="outline" onPress={()=>router.push("/staff-module-access")} />
          {isPlantOwner ? <>
            <AppText variant="label">Permissions for the next Manager appointment</AppText>
            {(["can_manage_staff","can_manage_permissions","can_manage_fleet","can_manage_drivers"] as const).map(key=><Pressable key={key} accessibilityRole="checkbox" accessibilityState={{checked:managerPolicy[key]}}
              onPress={()=>setManagerPolicy(old=>({...old,[key]:!old[key]}))}><AppText>{managerPolicy[key]?"☑":"☐"} {key.replace(/_/g," ")}</AppText></Pressable>)}
            <AppText variant="caption">Permission delegation is limited to the Manager&apos;s currently approved module grants.</AppText>
          </> : null}
        </Card> : null}

        {plants.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {plants.map((p) => {
              const selected = plantId === p.id;
              return (
                <Pressable key={p.id} onPress={() => {
                  if (selected) return;
                  loadVersion.current += 1;
                  setData(null);
                  setResources(null);
                  setQuery("");
                  setPlantId(p.id);
                }} style={[styles.chip, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}>
                  <AppText style={{ color: selected ? colors.onBrand : colors.onSurface, fontFamily: fonts.semibold, fontSize: 12 }}>{p.name}</AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {!plantId && !loading && !error ? <Card><AppText variant="bodyMuted">No plant is assigned to this account.</AppText></Card> : null}
        {error ? <Card><AppText style={{ color: colors.error }}>{error}</AppText><Button label="Retry" onPress={() => void reloadWorkspace()} /></Card> : null}
        {kind==="reports" && (isPlantOwner || permissions.plant_reports?.export) ? <Button label="Export plant summary" variant="outline" onPress={async()=>{
          if(!token || !plantId)return;
          try{
            const csv=await apiGet<string>(`/master/plants/${plantId}/summary/export`,token);
            if(Platform.OS==="web"){
              const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const link=document.createElement("a");
              link.href=url;link.download="plant-summary.csv";link.click();URL.revokeObjectURL(url);
            }else{await Share.share({message:csv,title:"Plant summary"});}
          }catch(e:any){toast(e.detail || "Report export failed","error");}
        }}/> : null}

        {loading ? (
          <><Skeleton height={82} style={{ borderRadius: radius.lg }} /><Skeleton height={82} style={{ borderRadius: radius.lg }} /></>
        ) : !plantId || (error && !data) ? null : kind === "reports" && report ? (
          <View style={styles.grid}>
            {[
              ["Orders", report.orders], ["Active", report.active_orders], ["Delivered m³", report.delivered_m3],
              ["Billed ₹", report.billed], ["Outstanding ₹", report.outstanding], ["Low stock", report.low_stock],
              ["Fleet", report.fleet], ["Available TMs", report.available_mixers],
            ].map(([label, value]) => (
              <Card key={String(label)} style={[styles.stat, {
                borderColor: Number(value || 0) > 0 && String(label) === "Low stock"
                  ? operationalStatus("critical", colors.isDark) + "70"
                  : colors.border
              }]}>
                <AppText variant="caption">{label}</AppText>
                <AppText variant="heading" style={{ color: Number(value || 0) <= 0 ? colors.onSurface
                  : operationalStatus(
                      (String(label) === "Low stock" ? "critical"
                        : String(label) === "Outstanding ₹" ? "warning"
                        : ["Delivered m³", "Available TMs"].includes(String(label)) ? "success"
                        : "neutral") as OperationalStatus,
                      colors.isDark,
                    ) }}>{String(value ?? 0)}</AppText>
              </Card>
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
            {moduleRows.length >= 4 || query ? (
              <View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
                <TextInput accessibilityLabel="Search records" value={query} onChangeText={setQuery} placeholder="Search…" placeholderTextColor={colors.onSurfaceTertiary} style={{ flex: 1, color: colors.onSurface, fontFamily: fonts.regular }} />
              </View>
            ) : null}
            {kind === "staff" && !canManageStaff && !loading ? (
              <Card><AppText>You do not have delegated Plant Manager access.</AppText></Card>
            ) : rows.length ? rows.map((r) => (
              <Card key={r.id} testID={kind==="staff" ? `staff-record-${r.raw?.role}` : undefined} style={{ gap: spacing.sm }}>
                <View style={{ gap: 4 }}>
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{r.title}</AppText>
                  {r.subtitle ? <AppText variant="caption">{r.subtitle}</AppText> : null}
                  {r.meta ? <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>{r.meta}</AppText> : null}
                  {r.stockStatus ? (
                    <Badge size="sm" {...r.stockStatus} />
                  ) : kind === "fleet" && r.raw?.status ? <Badge label={r.raw.status} status={r.raw.status} size="sm" /> : null}
                </View>
                {kind === "fleet" && canEditModule && ["idle", "available", "maintenance"].includes(r.raw?.status) ? (
                  <Button label={r.raw?.status === "maintenance" ? "Set Available" : "Set Maintenance"} variant="outline" onPress={() => toggleFleet(r)} />
                ) : null}
                {kind === "inventory" && canEditModule ? (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Button label="Stock In" onPress={() => openAdjustment(r, 1)} /></View>
                    {isPlantOwner ? <View style={{ flex: 1 }}><Button label="Stock Out" variant="outline" onPress={() => openAdjustment(r, -1)} /></View> : <AppText variant="caption">Owner approval is required for stock reductions.</AppText>}
                  </View>
                ) : null}
                {kind === "staff" && canManageStaff && STAFF_ROLE_OPTIONS.some((option) => option.value === r.raw?.role) ? (
                  <View style={{ gap: spacing.sm }}>
                    {r.raw?.is_manager ? <AppText variant="caption">Delegated Plant Manager</AppText> : null}
                    {isPlantOwner && r.raw?.active === true ? (
                      <Button label={r.raw?.is_manager ? "Revoke Manager Delegation" : "Appoint Plant Manager"}
                        variant="outline" onPress={() => toggleManager(r)} />
                    ) : null}
                    {r.raw?.status==="pending" ? <>
                      <Button label="Cancel invitation" variant="outline" onPress={()=>changeStaff(r,"cancel")} />
                      <Button label="Release expired invitation" variant="outline" onPress={()=>changeStaff(r,"expire")} />
                    </> : <>
                      <Button label={r.raw?.active === true ? "Suspend (keep role reserved)" : "Activate"} variant="outline" onPress={() => toggleStaff(r)} />
                      {removeConfirmId===`terminate-${r.id}` ? <>
                        <AppText variant="caption">Termination revokes access and releases this job slot. History is retained.</AppText>
                        <Button label="Confirm termination" variant="outline" onPress={()=>changeStaff(r,"terminate")} />
                        <Button label="Cancel termination" variant="outline" onPress={()=>setRemoveConfirmId(null)} />
                      </> : <Button label="Terminate employee" variant="outline" onPress={()=>setRemoveConfirmId(`terminate-${r.id}`)} />}
                    </>}
                    {removeConfirmId === r.id ? (
                      <View style={{ gap: spacing.sm }}>
                        <AppText variant="caption">Removing this assignment frees the role. Employee and payroll history are retained.</AppText>
                        <Button label="Confirm Remove Assignment" variant="outline" loading={saving} onPress={() => removeStaff(r)} />
                        <Button label="Cancel" variant="outline" onPress={() => setRemoveConfirmId(null)} />
                      </View>
                    ) : <Button label="Remove Assignment" variant="outline" onPress={() => setRemoveConfirmId(r.id)} />}
                  </View>
                ) : null}
              </Card>
            )) : <Card><AppText variant="bodyMuted">{query.trim() ? "No records match your search." : "No records yet."}</AppText></Card>}
          </>
        )}
        {kind === "staff" && canManageStaff ? <Card style={{gap:spacing.sm}}>
          <AppText variant="label">Assignment history</AppText>
          {staffHistory.events.length ? staffHistory.events.map(event=><View key={event.id} style={{gap:3}}>
            <AppText variant="caption">{event.role} · {event.old_status || "VACANT"} → {event.new_status} · {event.occurred_at}</AppText>
            <AppText variant="caption">{event.reason} · Actor {event.actor_user_id} ({event.actor_role})</AppText>
          </View>) : <AppText variant="caption">No lifecycle changes recorded.</AppText>}
        </Card> : null}

        {kind === "attendance" ? (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Button label="Check In" onPress={() => attendanceAction("checkin")} loading={saving} /></View>
            <View style={{ flex: 1 }}><Button label="Check Out" variant="outline" onPress={() => attendanceAction("checkout")} /></View>
          </View>
        ) : def.addLabel && plantId && canCreateModule ? <Button label={def.addLabel} onPress={openForm} /> : null}

        {(kind === "purchases" || kind === "diesel") && resources ? (
          <Card style={{ gap: spacing.sm }}>
            <AppText variant="label">Reference data</AppText>
            {kind === "purchases" ? <AppText variant="caption">Suppliers: {(resources.suppliers || []).map((x: any) => `${x.name} (${x.id})`).join(" · ") || "Create a supplier first"}</AppText> : null}
            {kind === "purchases" ? <AppText variant="caption">Materials: {(resources.materials || []).map((x: { name: string; id: string; unit: string }) => `${x.name} (${x.unit} · ${x.id})`).join(" · ") || "No materials"}</AppText> : null}
            {kind === "diesel" ? <AppText variant="caption">Mixers: {(resources.transit_mixers ?? resources.vehicles ?? []).map((x: any) => `${x.registration_number ?? x.tm_number} (${x.id})`).join(" · ") || "No mixers"}</AppText> : null}
          </Card>
        ) : null}
      </ScrollView>

      <Modal visible={modal} transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={() => setModal(false)}>
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
            <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <AppText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>{def.addLabel}</AppText>
                <Pressable accessibilityRole="button" accessibilityLabel="Close form" onPress={() => setModal(false)} style={styles.closeControl}>
                  <Ionicons name="close" size={24} color={colors.onSurface} />
                </Pressable>
              </View>
              {(def.fields || []).map((f) => (
                kind === "staff" && f.key === "role" ? (
                  <View key={f.key} style={{ gap: spacing.sm }}>
                    <AppText variant="label">Role</AppText>
                    <View style={styles.grid}>
                      {STAFF_ROLE_OPTIONS.filter((option) => user?.role === "plant_owner" || option.value !== "admin").map((option) => {
                        const selected = form.role === option.value;
                        const slot = roleSlotStatus(staffAssignments, option.value as PlantJobRole);
                        return (
                          <Pressable
                            key={option.value}
                            testID={`staff-role-${option.value}`}
                            disabled={slot !== "available"}
                            accessibilityState={{ disabled: slot !== "available", selected }}
                            onPress={() => setForm((current) => ({ ...current, role: option.value }))}
                            style={[styles.roleOption, { backgroundColor: selected ? colors.brand : colors.surfaceSecondary, borderColor: selected ? colors.brand : colors.border }]}
                          >
                            <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={17} color={selected ? colors.onBrand : colors.onSurfaceSecondary} />
                            <View style={{ flex: 1, gap: 2 }}>
                              <AppText style={{ fontFamily: fonts.medium, fontSize: fontSize.sm, color: selected ? colors.onBrand : colors.onSurface }}>{option.label}</AppText>
                              <AppText variant="caption">{slot === "available" ? "Available" : slot === "active" ? "Assigned" : slot==="pending" ? "Invitation pending · reserved" : "Suspended · reserved"}</AppText>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                    <AppText variant="caption">The work email must be verified and MFA completed before this invitation activates. Drivers use separate WhatsApp onboarding.</AppText>
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

      <Modal visible={!!adjustRow} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={() => setAdjustRow(null)}>
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={[styles.adjustSheet, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
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
  closeControl: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  roleOption: { width: "48%", minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.md },
  stat: { width: "48%", gap: 4 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
  adjustSheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
});
