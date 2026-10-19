import React from "react";
import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { TabDef } from "@/src/components/GlassTabBar";
import { OwnerTabBar } from "@/src/owner/OwnerTabBar";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getThemedSceneStyle } from "@/src/theme/sceneBackground";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "orders", label: "Orders", icon: "cube-outline", active: "cube" },
  { name: "operations", label: "Operations", icon: "construct-outline", active: "construct" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function OwnerLayout() {
  const { hydrating, token, user } = useAuth();
  const { colors } = useTheme();
  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  // The Rust API still persists the legacy "owner" alias for plant_owner.
  // Both identities have the same owner workspace; no other role may enter.
  if (user.role !== "plant_owner" && user.role !== "owner") return <Redirect href="/role-home" />;

  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: getThemedSceneStyle(colors) }} tabBar={(props) => <OwnerTabBar {...props} tabs={TABS} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}
