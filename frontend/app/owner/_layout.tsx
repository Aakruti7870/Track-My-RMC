import React from "react";
import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { GlassTabBar, TabDef } from "@/src/components/GlassTabBar";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "orders", label: "Orders", icon: "cube-outline", active: "cube" },
  { name: "operations", label: "Operations", icon: "construct-outline", active: "construct" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function OwnerLayout() {
  const { hydrating, token, user } = useAuth();
  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  // The Rust API still persists the legacy "owner" alias for plant_owner.
  // Both identities have the same owner workspace; no other role may enter.
  if (user.role !== "plant_owner" && user.role !== "owner") return <Redirect href="/role-home" />;

  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }} tabBar={(props) => <GlassTabBar {...props} tabs={TABS} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}
