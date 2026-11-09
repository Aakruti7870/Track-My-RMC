import { modulesForRole, type RoleModule } from "@/src/navigation/moduleCatalog";

const catalog = modulesForRole("plant_owner");
// A destination has one visible owner placement: Home, Operations, or More.
// Owner Quick Access has four routed shortcuts plus the local Insights toggle.
export const HOME_KEYS = ["owner-orders", "owner-production-dispatch", "business-inventory", "business-staff"];
export const OPERATIONS_KEYS = ["owner-orders", "owner-production-dispatch", "owner-incidents", "business-mixes", "business-inventory", "business-suppliers", "business-purchases", "business-fleet", "business-diesel", "business-reports", "owner-billing"];
// Workforce and Commercial are consolidated into the Home grid. Keep the
// two Payroll destinations within ONE card (two distinct controls).
export const WORKFORCE_KEYS = ["business-payroll", "business-attendance", "workforce", "shift-roster", "my-payslip", "workforce-reports", "employee-master", "payroll-closure"];
export const ACCOUNT_KEYS = ["account-kyc", "owner-premium", "public-plant-profile", "business-profile"];
export const COMMERCIAL_KEYS = ["owner-billing-history", "owner-quotation-requests", "business-rates", "business-quotations", "business-expenses", "business-customers"];
export const HOME_COMMERCIAL_KEYS = [...COMMERCIAL_KEYS, "business-payroll", "workforce", "shift-roster", "my-payslip", "workforce-reports", "employee-master", "payroll-closure"];

export function ownerModules(keys: readonly string[]): RoleModule[] {
  const seen = new Set<string>();
  return keys.flatMap(key => catalog.filter(module => module.key === key))
    .filter(module => {
      if (HOME_KEYS.includes(module.key) || seen.has(module.key)) return false;
      seen.add(module.key);
      return true;
    })
    .map(module => module.key === "business-purchases" ? { ...module, symbol: "material-receipts" as const } : module);
}
export function ownerDestination(module: RoleModule) {
  return module.key === "owner-production-dispatch"
    ? { pathname: "/owner/orders" as const, params: { status: "processing", today: "" } }
    : module.route;
}
export const DRIVER_MODULE: RoleModule = { key: "owner-drivers", label: "Driver Onboarding", description: "Employment, contacts and mixer assignments.", icon: "people-outline", symbol: "drivers", route: "/owner/drivers", group: "Workforce", roles: ["plant_owner"] };
