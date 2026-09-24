import React from "react";
import { StaffTabs } from "@/src/screens/StaffTabs";
import { TabDef } from "@/src/components/GlassTabBar";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "operations", label: "Operations", icon: "construct-outline", active: "construct" },
  { name: "incidents", label: "Incidents", icon: "warning-outline", active: "warning" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function Layout() {
  return <StaffTabs role="supervisor" tabs={TABS} />;
}
