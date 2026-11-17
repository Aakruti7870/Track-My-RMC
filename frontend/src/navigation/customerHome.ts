import type { Href } from "expo-router";
import type { VectorSymbolName } from "@/src/components/VectorSymbol";
import { modulesForRole } from "@/src/navigation/moduleCatalog";

type EnquiryService = "cement" | "labour" | "material" | "pump" | "bulk";

export function enquiryRoute(service: EnquiryService, material?: string): Href {
  return { pathname: "/customer/service-enquiry", params: material ? { service, material } : { service } };
}

const catalog = modulesForRole("customer");
export type HomeLink = { key: string; label: string; symbol: VectorSymbolName; route: Href; hint?: string };

export function planningLinks(keys: readonly string[]): HomeLink[] {
  return keys.flatMap(key => {
    const item = catalog.find(module => module.key === key);
    if (!item?.symbol) return [];
    const label = key === "free-tools" ? "RMC Calculator"
      : item.label;
    return [{ key, label, symbol: item.symbol, route: item.route }];
  });
}

export const pumpLink: HomeLink = {
  key: "pump-rental", label: "Rent a Concrete Pump", symbol: "pump-rental", route: enquiryRoute("pump"),
};

export const homeShortcuts: readonly HomeLink[] = [
  { key: "new", label: "New Order", symbol: "new-order", route: "/new-order",
    hint: "Build and save a request without completing KYC first" },
  ...planningLinks(["saved-sites", "free-tools"]),
  { ...pumpLink, label: "Concrete Pump" },
  ...planningLinks(["pour-planner"]).map(link => ({ ...link, label: "Pour Planner" })),
];

export const materialPreview: readonly HomeLink[] = [
  { key: "cement", label: "Cement", symbol: "cement", route: enquiryRoute("cement") },
  { key: "sand", label: "Sand", symbol: "sand", route: enquiryRoute("material", "sand") },
  { key: "bricks", label: "Bricks", symbol: "bricks", route: enquiryRoute("material", "bricks") },
];

export const moreMaterials: readonly HomeLink[] = [
  { key: "steel", label: "Purchase Steel", symbol: "steel", route: enquiryRoute("material", "steel") },
  { key: "labour", label: "Hire Labour Contractor", symbol: "labour-contractor", route: enquiryRoute("labour") },
  { key: "office-cabin", label: "Buy Office Cabin", symbol: "office-cabin", route: enquiryRoute("material", "office-cabin") },
  { key: "shuttering", label: "Shuttering Material", symbol: "shuttering", route: enquiryRoute("material", "shuttering") },
  { key: "material", label: "Building Materials", symbol: "building-material", route: enquiryRoute("material") },
];
