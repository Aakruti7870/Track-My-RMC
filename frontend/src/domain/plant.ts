export type Plant = {
  id: string;
  name: string;
  city: string;
  district?: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  grades: string[];
  contact_phone: string;
  service_area_km: number;
  status?: string;
  verified: boolean;
  order_enabled?: boolean;
  distance_km?: number | null;
  promoted?: boolean;
  promotion_ends_at?: string | null;
};
