// Role-based discovery only. Backend permissions still authorize each action.
// Restricted Authority and Central Admin workspaces are intentionally excluded
// until dedicated approved identities and authorization flows exist.
import type { Href } from "expo-router";
import type { VectorSymbolName } from "@/src/components/VectorSymbol";
import type { Ionicons } from "@expo/vector-icons";

export const MOBILE_ROLES = ["customer","plant_owner","driver","admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"] as const;
export type MobileRole = (typeof MOBILE_ROLES)[number];
export type ModuleGroup = "Operations" | "Commercial" | "Workforce" | "Tools" | "Account";

export type RoleModule = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  /** Uploaded artwork for this actual destination; Ionicons remains fallback. */
  readonly symbol?: VectorSymbolName;
  readonly route: Href;
  readonly group: ModuleGroup;
  readonly roles: readonly MobileRole[];
  readonly customerHome?: boolean;
};

// Every entry targets an implemented Expo route. Visibility is not a claim of
// full feature parity or authorization to perform server-side mutations.
export const MODULE_CATALOG: readonly RoleModule[] = [
  { key: "new-order", label: "New Order", description: "Place a concrete order with a verified customer identity.", icon: "add-circle-outline", symbol: "new-order", route: "/new-order", group: "Operations", roles: ["customer"] },
  { key: "orders", label: "My Orders", description: "Review orders and delivery status.", icon: "cube-outline", symbol: "my-orders", route: "/customer/orders", group: "Operations", roles: ["customer"] },
  { key: "plants", label: "Available Plants", description: "Discover approved RMC plants.", icon: "business-outline", symbol: "nearby-rmc-plants", route: "/customer/plants", group: "Operations", roles: ["customer"] },
  { key: "projects", label: "Project & Site Hub", description: "Manage project sites and records.", icon: "briefcase-outline", symbol: "project-site-hub", route: "/customer/projects", group: "Operations", roles: ["customer"], customerHome: true },
  { key: "pour-planner", label: "Concrete Pour Planner", description: "Plan upcoming concrete pours.", icon: "time-outline", symbol: "concrete-pour-planner", route: "/customer/pour-planner", group: "Operations", roles: ["customer"], customerHome: true },
  { key: "receiving-guide", label: "Receiving & Quality Guide", description: "Delivery and quality guidance.", icon: "shield-checkmark-outline", symbol: "receiving-quality-guide", route: "/customer/receiving-guide", group: "Operations", roles: ["customer"], customerHome: true },
  { key: "cube-tests", label: "Cube Test Follow-up", description: "Follow concrete test results.", icon: "flask-outline", symbol: "cube-test-follow-up", route: "/customer/cube-test-follow-up", group: "Operations", roles: ["customer"], customerHome: true },
  { key: "saved-sites", label: "Saved Sites", description: "Review saved site addresses.", icon: "location-outline", symbol: "saved-sites", route: "/customer/sites", group: "Operations", roles: ["customer"] },
  { key: "compare-plants", label: "Estimate & Compare Plants", description: "Compare plants and estimates.", icon: "git-compare-outline", symbol: "compare-plants", route: "/customer/compare-plants", group: "Tools", roles: ["customer"], customerHome: true },
  { key: "quotations", label: "Quotations", description: "Review your quotations.", icon: "document-text-outline", symbol: "quotations", route: "/customer/quotations", group: "Commercial", roles: ["customer"], customerHome: true },
  { key: "documents", label: "Documents", description: "Order-related documents.", icon: "folder-outline", symbol: "documents", route: "/customer/documents", group: "Commercial", roles: ["customer"], customerHome: true },
  { key: "free-tools", label: "Free RMC Tools", description: "Concrete quantity and planning calculators.", icon: "calculator-outline", symbol: "free-rmc-tools", route: "/customer/free-tools", group: "Tools", roles: ["customer"], customerHome: true },
  { key: "account-kyc", label: "KYC Verification", description: "Manage your approved KYC workflow.", icon: "id-card-outline", symbol: "kyc-verification", route: "/kyc", group: "Account", roles: ["customer","plant_owner"] },
  { key: "account-deletion", label: "Account Deletion", description: "Request account deletion.", icon: "trash-outline", route: "/account-deletion", group: "Account", roles: ["customer"] },
  { key: "customer-support", label: "Customer Support", description: "Open customer support.", icon: "help-circle-outline", symbol: "support", route: "/support", group: "Account", roles: ["customer"] },
  { key: "driver-trips", label: "Assigned Trips", description: "Review assigned deliveries.", icon: "navigate-outline", symbol: "assigned-trips", route: "/driver/trips", group: "Operations", roles: ["driver"] },
  { key: "driver-attendance", label: "Driver Attendance", description: "Check your daily shift.", icon: "time-outline", symbol: "driver-attendance", route: "/driver/attendance", group: "Workforce", roles: ["driver"] },
  { key: "driver-sos", label: "Emergency / SOS", description: "Report a delivery emergency.", icon: "warning-outline", symbol: "emergency-sos", route: "/sos", group: "Operations", roles: ["driver"] },
  { key: "owner-orders", label: "Plant Orders", description: "Approve and manage plant orders.", icon: "cube-outline", symbol: "plant-orders", route: "/owner/orders", group: "Operations", roles: ["plant_owner"] },
  { key: "owner-production-dispatch", label: "Production & Dispatch", description: "View batching and dispatch workflows.", icon: "construct-outline", symbol: "production-dispatch", route: "/owner/operations", group: "Operations", roles: ["plant_owner"] },
  { key: "owner-billing", label: "Billing & Ledger", description: "Invoices, payments and outstanding balance.", icon: "wallet-outline", symbol: "billing-ledger", route: "/owner/billing", group: "Commercial", roles: ["plant_owner"] },
  { key: "owner-billing-history", label: "Billing History", description: "Review previous plant billing.", icon: "receipt-outline", symbol: "billing-history", route: "/owner/billing-history", group: "Commercial", roles: ["plant_owner"] },
  { key: "owner-quotation-requests", label: "Quotation Requests", description: "Respond to plant RFQs.", icon: "document-text-outline", symbol: "quotation-requests", route: "/owner/quotation-requests", group: "Commercial", roles: ["plant_owner"] },
  { key: "owner-incidents", label: "Incident / SOS Register", description: "Review plant incident alerts.", icon: "warning-outline", symbol: "incident-register", route: "/owner/incidents", group: "Operations", roles: ["plant_owner"] },
  { key: "owner-premium", label: "Premium & Promotions", description: "Manage plant listing plans and promotions.", icon: "diamond-outline", symbol: "premium-promotions", route: "/plans-promotions", group: "Account", roles: ["plant_owner"] },
  { key: "admin-orders", label: "Plant Order Management", description: "Manage assigned plant orders.", icon: "cube-outline", symbol: "plant-order-management", route: "/admin/orders", group: "Operations", roles: ["admin"] },
  { key: "admin-fleet", label: "Fleet Operations", description: "Review assigned mixers and fleet.", icon: "bus-outline", symbol: "transit-mixer-fleet", route: "/admin/fleet", group: "Operations", roles: ["admin"] },
  { key: "admin-onboarding", label: "Plant Onboarding Review", description: "Review pending plant requests.", icon: "business-outline", symbol: "plant-onboarding-review", route: "/admin-plant-onboarding", group: "Operations", roles: ["admin"] },
  { key: "dispatcher-queue", label: "Dispatch Queue", description: "Assign loads, mixers and drivers.", icon: "send-outline", symbol: "dispatch-queue", route: "/dispatcher/dispatch", group: "Operations", roles: ["dispatcher"] },
  { key: "dispatcher-fleet", label: "Fleet Availability", description: "Review available transport.", icon: "bus-outline", symbol: "fleet-availability", route: "/dispatcher/fleet", group: "Operations", roles: ["dispatcher"] },
  { key: "operator-production", label: "Production Queue", description: "Review scheduled and active production.", icon: "flame-outline", symbol: "production-queue", route: "/operator/production", group: "Operations", roles: ["operator"] },
  { key: "supervisor-operations", label: "Supervisor Operations", description: "Supervise plant activity.", icon: "construct-outline", symbol: "batching-operations", route: "/supervisor/operations", group: "Operations", roles: ["supervisor"] },
  { key: "supervisor-incidents", label: "Incidents / SOS", description: "Review escalated incidents.", icon: "warning-outline", symbol: "incident-register", route: "/supervisor/incidents", group: "Operations", roles: ["supervisor"] },
  { key: "accountant-billing", label: "Billing", description: "Plant billing records.", icon: "receipt-outline", symbol: "billing", route: "/accountant/billing", group: "Commercial", roles: ["accountant"] },
  { key: "accountant-ledger", label: "Ledger", description: "Invoices and payments.", icon: "book-outline", symbol: "ledger", route: "/accountant/ledger", group: "Commercial", roles: ["accountant"] },
  { key: "engineer-quality", label: "Quality Register", description: "Record and review plant tests.", icon: "flask-outline", symbol: "quality-register", route: "/quality_engineer/quality", group: "Operations", roles: ["quality_engineer"] },
  { key: "fleet-manager-fleet", label: "Transit Mixer Fleet", description: "Manage fleet availability.", icon: "bus-outline", symbol: "transit-mixer-fleet", route: "/fleet_manager/fleet", group: "Operations", roles: ["fleet_manager"] },
  { key: "fleet-manager-drivers", label: "Drivers", description: "Review plant driver records.", icon: "people-outline", symbol: "drivers", route: "/fleet_manager/drivers", group: "Operations", roles: ["fleet_manager"] },
  { key: "store-manager-stock", label: "Stock Register", description: "Track material stock.", icon: "cube-outline", symbol: "stock-register", route: "/store_manager/stock", group: "Operations", roles: ["store_manager"] },
  { key: "business-profile", label: "Plant Profile", description: "Plant business and invoice identity.", icon: "business-outline", symbol: "plant-profile", route: "/business/profile", group: "Account", roles: ["plant_owner"] },
  { key: "business-rates", label: "Rate Cards", description: "Plant-specific concrete pricing.", icon: "pricetag-outline", symbol: "rate-cards", route: "/business/rates", group: "Commercial", roles: ["plant_owner","admin","accountant"] },
  { key: "business-mixes", label: "Mix Designs", description: "Concrete mix recipes.", icon: "flask-outline", symbol: "mix-designs", route: "/business/mixes", group: "Operations", roles: ["plant_owner","admin","operator","supervisor","quality_engineer"] },
  { key: "business-inventory", label: "Material Inventory", description: "Materials and reorder quantities.", icon: "cube-outline", symbol: "material-inventory", route: "/business/inventory", group: "Operations", roles: ["plant_owner","admin","store_manager","dispatcher","operator","supervisor","quality_engineer"] },
  { key: "business-suppliers", label: "Suppliers", description: "Supplier records.", icon: "people-circle-outline", symbol: "suppliers", route: "/business/suppliers", group: "Operations", roles: ["plant_owner","admin","store_manager"] },
  { key: "business-purchases", label: "Purchases", description: "Material receipts.", icon: "cart-outline", symbol: "purchases", route: "/business/purchases", group: "Operations", roles: ["plant_owner","admin","store_manager"] },
  { key: "business-fleet", label: "Fleet Management", description: "Transit mixers and capacity.", icon: "bus-outline", symbol: "transit-mixer-fleet", route: "/business/fleet", group: "Operations", roles: ["plant_owner","admin","fleet_manager"] },
  { key: "business-diesel", label: "Diesel Ledger", description: "Fuel receipt and consumption.", icon: "water-outline", symbol: "diesel-ledger", route: "/business/diesel", group: "Operations", roles: ["plant_owner","admin","fleet_manager","store_manager"] },
  { key: "business-quotations", label: "Plant Quotations", description: "Plant customer quotations.", icon: "document-text-outline", symbol: "quotations", route: "/business/quotations", group: "Commercial", roles: ["plant_owner","admin","accountant"] },
  { key: "business-expenses", label: "Expenses", description: "Plant expense register.", icon: "cash-outline", symbol: "expenses", route: "/business/expenses", group: "Commercial", roles: ["plant_owner","admin","accountant"] },
  { key: "business-payroll", label: "Payroll", description: "Payroll records.", icon: "card-outline", symbol: "payroll", route: "/business/payroll", group: "Workforce", roles: ["plant_owner","admin","accountant"] },
  { key: "business-attendance", label: "Plant Attendance", description: "Plant attendance records.", icon: "calendar-outline", symbol: "attendance", route: "/business/attendance", group: "Workforce", roles: ["plant_owner","admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"] },
  { key: "business-staff", label: "Plant Staff", description: "Manage linked plant staff.", icon: "people-outline", symbol: "plant-staff", route: "/business/staff", group: "Workforce", roles: ["plant_owner","admin"] },
  { key: "business-customers", label: "Plant Customers", description: "Customers associated with a plant.", icon: "person-outline", symbol: "profile", route: "/business/customers", group: "Commercial", roles: ["plant_owner","admin"] },
  { key: "business-reports", label: "Plant Reports", description: "Plant reports and summary.", icon: "bar-chart-outline", symbol: "plant-reports", route: "/business/reports", group: "Operations", roles: ["plant_owner","admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"] },
  { key: "workforce", label: "Workforce & Field Activity", description: "Attendance, leave and field activity.", icon: "people-circle-outline", symbol: "attendance", route: "/workforce", group: "Workforce", roles: ["plant_owner","driver","admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"] },
  { key: "shift-roster", label: "My Shift & Roster", description: "Upcoming shifts and roster.", icon: "calendar-outline", symbol: "shift-roster", route: "/shift-roster", group: "Workforce", roles: ["plant_owner","driver","admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"] },
  { key: "my-payslip", label: "My Payslip", description: "Read closed payroll payslips.", icon: "document-text-outline", symbol: "my-payslip", route: "/my-payslip", group: "Workforce", roles: ["plant_owner","driver","admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"] },
  { key: "workforce-reports", label: "Workforce Reports", description: "Monthly workforce and payroll reports.", icon: "stats-chart-outline", symbol: "workforce-reports", route: "/workforce-reports", group: "Workforce", roles: ["plant_owner","accountant"] },
  { key: "employee-master", label: "Employee Master & Salary", description: "Employee salary structures.", icon: "id-card-outline", symbol: "employee-master-salary", route: "/employee-master", group: "Workforce", roles: ["plant_owner","accountant"] },
  { key: "payroll-closure", label: "Payroll Closure & Payslips", description: "Closed payroll periods and exports.", icon: "document-attach-outline", symbol: "payroll-closure", route: "/payroll-closure", group: "Workforce", roles: ["plant_owner","accountant"] },
  { key: "notifications", label: "Notifications", description: "Review app notifications.", icon: "notifications-outline", symbol: "notifications", route: "/notifications", group: "Account", roles: ["customer","plant_owner","driver","admin","dispatcher","operator","supervisor","accountant","quality_engineer","fleet_manager","store_manager"] },
];

export function modulesForRole(role: string | null | undefined): RoleModule[] {
  // Keep the existing persisted owner alias; never alias Authority/Admin roles.
  const normalized = role === "owner" ? "plant_owner" : role;
  if (!normalized || !MOBILE_ROLES.includes(normalized as MobileRole)) return [];
  return MODULE_CATALOG.filter(module => module.roles.includes(normalized as MobileRole));
}

export function customerHomeModules(): RoleModule[] {
  return modulesForRole("customer").filter(module => module.customerHome);
}
