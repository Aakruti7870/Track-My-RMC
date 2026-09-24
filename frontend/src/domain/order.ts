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
