import orderStages from "./order-status-colors.json";

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

export function orderStatusColor(status: string, dark: boolean): string | undefined {
  const normalized = status.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const stage = Object.values(orderStages).find(({ aliases }) => aliases.includes(normalized));
  return stage?.[dark ? "dark" : "light"];
}
