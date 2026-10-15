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
  // Original backend roles: displayed for audit only; no mobile route or permission is granted.
  authority: "Authority",
  central_admin: "Central Admin",
  owner: "Plant Owner",
};

// Role navigation metadata mirrored from real Expo app/<role>/_layout.tsx files.
// This is presentation-only metadata; the backend remains the authorization authority.
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
  admin: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "orders", label: "Orders", icon: "cube-outline" },
    { key: "fleet", label: "Fleet", icon: "bus-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  dispatcher: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "dispatch", label: "Dispatch", icon: "send-outline" },
    { key: "fleet", label: "Fleet", icon: "bus-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  operator: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "production", label: "Production", icon: "flame-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  supervisor: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "operations", label: "Operations", icon: "construct-outline" },
    { key: "incidents", label: "Incidents", icon: "warning-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  accountant: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "billing", label: "Billing", icon: "receipt-outline" },
    { key: "ledger", label: "Ledger", icon: "book-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  quality_engineer: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "quality", label: "Quality", icon: "flask-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  fleet_manager: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "fleet", label: "Fleet", icon: "bus-outline" },
    { key: "drivers", label: "Drivers", icon: "people-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
  store_manager: [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "stock", label: "Stock", icon: "cube-outline" },
    { key: "more", label: "More", icon: "grid-outline" },
  ],
};

// Legacy DB role alias; access is still checked by the owner route guards and Rust APIs.
ROLE_NAV.owner = ROLE_NAV.plant_owner;
