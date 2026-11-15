import type { Href } from "expo-router";
import type { VectorSymbolName } from "@/src/components/VectorSymbol";
import { modulesForRole } from "@/src/navigation/moduleCatalog";

type EnquiryService = "cement" | "labour" | "material" | "pump" | "bulk";

export function enquiryRoute(service: EnquiryService, material?: string): Href {
  return { pathname: "/customer/service-enquiry", params: material ? { service, material } : { service } };
}

const catalog = modulesForRole("customer");
export const planningKeys = [
  "free-tools", "pour-planner", "projects", "saved-sites", "cube-tests", "receiving-guide",
] as const;
const morePlanningKeys = ["compare-plants", "quotations", "documents"] as const;

export type HomeLink = { key: string; label: string; symbol: VectorSymbolName; route: Href; hint?: string };

function planningLinks(keys: readonly string[]): HomeLink[] {
  return keys.flatMap(key => {
    const item = catalog.find(module => module.key === key);
    if (!item?.symbol) return [];
    const label = key === "free-tools" ? "RMC Calculator"
      : key === "projects" ? "Project Hub"
      : key === "receiving-guide" ? "Quality Guide" : item.label;
    return [{ key, label, symbol: item.symbol, route: item.route }];
  });
}

export const planningPreview: readonly HomeLink[] = [
  ...planningLinks(planningKeys),
  { key: "pump-rental", label: "Rent a Concrete Pump", symbol: "pump-rental", route: enquiryRoute("pump") },
];

export const morePlanning: readonly HomeLink[] = [
  { key: "order-request", label: "Start an Order Request", symbol: "new-order", route: "/new-order",
    hint: "Build and save a request without completing KYC first" },
  ...planningLinks(morePlanningKeys),
];

export const materialPreview: readonly HomeLink[] = [
  { key: "cement", label: "Cement", symbol: "cement", route: enquiryRoute("cement") },
  { key: "sand", label: "Sand", symbol: "stock-register", route: enquiryRoute("material", "sand") },
  { key: "bricks", label: "Bricks", symbol: "building-material", route: enquiryRoute("material", "bricks") },
];

export const moreMaterials: readonly HomeLink[] = [
  { key: "steel", label: "Purchase Steel", symbol: "material-receipts", route: enquiryRoute("material", "steel") },
  { key: "labour", label: "Hire Labour Contractor", symbol: "labour-contractor", route: enquiryRoute("labour") },
  { key: "office-cabin", label: "Buy Office Cabin", symbol: "store-dashboard", route: enquiryRoute("material", "office-cabin") },
  { key: "shuttering", label: "Shuttering Material", symbol: "material-inventory", route: enquiryRoute("material", "shuttering") },
  { key: "material", label: "Building Materials", symbol: "building-material", route: enquiryRoute("material") },
];
