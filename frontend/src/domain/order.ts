export type Order = {
  id: string;
  order_number: string;
  plant_name: string;
  grade: string;
  quantity: number;
  site_name: string;
  site_address?: string;
  delivery_date: string;
  delivery_time?: string;
  status: string;
  payment_status: string;
  tm_number?: string;
  driver_name?: string;
  driver_mobile?: string;
  challan_number?: string;
  invoice_number?: string;
};

const orderStages = {
  pending: ["PENDING", "PENDING_APPROVAL", "PENDING_KYC", "PENDING_SUPPLIER"],
  accepted: ["ACCEPTED", "APPROVED", "CONFIRMED", "SCHEDULED"],
  preparing: ["PREPARING", "IN_PRODUCTION", "PRODUCED", "PRODUCTION_COMPLETE", "LOADING", "READY_TO_DISPATCH", "TM_ASSIGNED", "DRIVER_ASSIGNED", "ASSIGNED"],
  dispatched: ["DISPATCHED", "IN_TRANSIT", "EN_ROUTE", "AT_SITE", "POURING", "UNLOADING", "POD_PENDING"],
  delivered: ["DELIVERED", "COMPLETED"],
  cancelled: ["CANCELLED", "REJECTED", "FAILED"],
} satisfies Record<string, readonly string[]>;

type OrderStage = keyof typeof orderStages;

const stageColors: Record<OrderStage, { light: string; dark: string }> = {
  pending: { light: "#B91C1C", dark: "#FF7777" },
  accepted: { light: "#1D4ED8", dark: "#93C5FD" },
  preparing: { light: "#785800", dark: "#FACC15" },
  dispatched: { light: "#166534", dark: "#4ADE80" },
  delivered: { light: "#9A3E08", dark: "#FFAA5C" },
  cancelled: { light: "#B91C1C", dark: "#FF7777" },
};

export function orderStatusColor(status: string, dark: boolean): string | undefined {
  const normalized = status.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const stage = (Object.keys(orderStages) as OrderStage[]).find(key => orderStages[key].includes(normalized));
  return stage ? stageColors[stage][dark ? "dark" : "light"] : undefined;
}
