import React from "react";
import { StaffTabs } from "@/src/screens/StaffTabs";
import { TabDef } from "@/src/components/GlassTabBar";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "orders", label: "Orders", icon: "cube-outline", active: "cube" },
  { name: "fleet", label: "Fleet", icon: "bus-outline", active: "bus" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function Layout() {
  return <StaffTabs role="admin" tabs={TABS} />;
}
