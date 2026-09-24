// Role -> bottom navigation config (mirrors the spec's exact role navigation).
import { Ionicons } from "@expo/vector-icons";

type IconName = keyof typeof Ionicons.glyphMap;

export type RoleTab = { key: string; label: string; icon: IconName };

export const ROLE_LABELS: Record<string, string> = {
  customer: "Customer",
  driver: "Driver",
  plant_owner: "Plant Owner",
  admin: "Admin",
  dispatcher: "Dispatcher",
  operator: "Plant Operator",
  supervisor: "Supervisor",
  accountant: "Accountant",
  quality_engineer: "Quality Engineer",
  fleet_manager: "Fleet Manager",
  store_manager: "Store Manager",
};

// Exact per-role bottom tabs from the spec. Only Customer is implemented in
// Phase 1; the rest are the blueprint for later phases.
export const ROLE_NAV: Record<string, RoleTab[]> = {
  customer: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "orders", label: "Orders", icon: "cube-outline" },
    { key: "plants", label: "Plants", icon: "business-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  driver: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "trips", label: "Trips", icon: "navigate-outline" },
    { key: "attendance", label: "Attendance", icon: "time-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  plant_owner: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "orders", label: "Orders", icon: "cube-outline" },
    { key: "operations", label: "Operations", icon: "construct-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
};
