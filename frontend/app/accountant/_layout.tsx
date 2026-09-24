import React from "react";
import { StaffTabs } from "@/src/screens/StaffTabs";
import { TabDef } from "@/src/components/GlassTabBar";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "billing", label: "Billing", icon: "receipt-outline", active: "receipt" },
  { name: "ledger", label: "Ledger", icon: "book-outline", active: "book" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function Layout() {
  return <StaffTabs role="accountant" tabs={TABS} />;
}
