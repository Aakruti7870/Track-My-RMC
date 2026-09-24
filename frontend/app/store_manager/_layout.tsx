import React from "react";
import { StaffTabs } from "@/src/screens/StaffTabs";
import { TabDef } from "@/src/components/GlassTabBar";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "stock", label: "Stock", icon: "cube-outline", active: "cube" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function Layout() {
  return <StaffTabs role="store_manager" tabs={TABS} />;
}
