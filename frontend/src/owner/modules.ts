import { modulesForRole, type RoleModule } from "@/src/navigation/moduleCatalog";

const catalog = modulesForRole("plant_owner");
export const OPERATIONS_KEYS = ["owner-orders", "owner-production-dispatch", "owner-incidents", "business-mixes", "business-inventory", "business-suppliers", "business-purchases", "business-fleet", "business-diesel", "business-reports"];
export const WORKFORCE_KEYS = ["business-payroll", "business-attendance", "business-staff", "workforce", "shift-roster", "my-payslip", "workforce-reports", "employee-master", "payroll-closure"];
export const ACCOUNT_KEYS = ["account-kyc", "owner-premium", "business-profile", "notifications"];
export const COMMERCIAL_KEYS = ["owner-billing", "owner-billing-history", "owner-quotation-requests", "business-rates", "business-quotations", "business-expenses", "business-customers"];
export function ownerModules(keys: string[]): RoleModule[] {
  return keys.flatMap(key => catalog.filter(module => module.key === key)).map(module => module.key === "business-purchases" ? { ...module, symbol: "material-receipts" as const } : module);
}
export function ownerDestination(module: RoleModule) {
  // Production actions already live inside the existing order detail workflow.
  return module.key === "owner-production-dispatch"
    ? { pathname: "/owner/orders" as const, params: { status: "processing", today: "" } }
    : module.route;
}
export const DRIVER_MODULE: RoleModule = { key: "owner-drivers", label: "Driver Onboarding", description: "Employment, contacts and mixer assignments.", icon: "people-outline", symbol: "drivers", route: "/owner/drivers", group: "Workforce", roles: ["plant_owner"] };
