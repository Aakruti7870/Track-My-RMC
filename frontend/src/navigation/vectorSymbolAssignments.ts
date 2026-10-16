import type { VectorSymbolName } from "@/src/components/VectorSymbol";

/**
 * Shared, presentation-only mapping for the existing navigation options.
 * Does not change routes, role visibility or authorization.
 */
const TAB_SYMBOLS: Readonly<Record<string, VectorSymbolName>> = {
  "Home": "home",
  "Orders": "orders",
  "Plants": "plants",
  "More": "more",
  "Trips": "assigned-trips",
  "Attendance": "driver-attendance",
  "Operations": "production-dispatch",
  "Dispatch": "dispatch-queue",
  "Fleet": "transit-mixer-fleet",
  "Production": "production-queue",
  "Batches": "batching-operations",
  "Incidents": "incident-register",
  "Billing": "billing",
  "Ledger": "ledger",
  "Quality": "quality-register",
  "Mix Design": "mix-designs",
  "Drivers": "drivers",
  "Stock": "stock-register",
  "Purchase": "purchases",
};

/** Role-specific icons override generic labels where the business meaning differs. */
export function tabVectorSymbol(label: string, role?: string | null): VectorSymbolName | undefined {
  if (label === "Home") {
    if (role === "plant_owner" || role === "owner") return "plant-dashboard";
    if (role === "admin") return "admin-dashboard";
    if (role === "store_manager") return "store-dashboard";
  }
  if (label === "Orders") {
    if (role === "customer") return "my-orders";
    if (role === "plant_owner" || role === "owner") return "plant-orders";
    if (role === "admin") return "plant-order-management";
  }
  if (label === "Fleet" && role === "dispatcher") return "fleet-availability";
  if (label === "Operations" && role === "supervisor") return "batching-operations";
  return TAB_SYMBOLS[label];
}
