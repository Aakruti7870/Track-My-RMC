import React from "react";
import { StaffTabs } from "@/src/screens/StaffTabs";
import { TabDef } from "@/src/components/GlassTabBar";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "quality", label: "Quality", icon: "flask-outline", active: "flask" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function Layout() {
  return <StaffTabs role="quality_engineer" tabs={TABS} />;
}
