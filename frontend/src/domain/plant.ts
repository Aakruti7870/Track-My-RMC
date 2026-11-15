export type Plant = {
  id: string;
  name: string;
  city: string;
  district?: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  google_place_id?: string | null;
  grades: string[];
  contact_phone: string;
  service_area_km: number;
  status?: string;
  verified: boolean;
  order_enabled?: boolean;
  order_intake_mode?: "DIRECT" | "ADMIN_REVIEW" | "RFQ_ONLY" | "DISABLED";
  distance_km?: number | null;
  promoted?: boolean;
  promotion_ends_at?: string | null;
};

export function plantOrderRoute(plant: Plant): "direct" | "review" | "unavailable" {
  if (plant.status === "google_listing") return "review";
  if ((plant.status && plant.status !== "active")
      || plant.order_intake_mode === "RFQ_ONLY" || plant.order_intake_mode === "DISABLED") {
    return "unavailable";
  }
  if (plant.order_intake_mode === "ADMIN_REVIEW" || !plant.verified) return "review";
  return plant.order_enabled === false ? "unavailable" : "direct";
}
