import React from "react";
import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { GlassTabBar, TabDef } from "@/src/components/GlassTabBar";
import { usePermissions } from "@/src/permissions/PermissionProvider";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "orders", label: "Orders", icon: "cube-outline", active: "cube" },
  { name: "plants", label: "Plants", icon: "business-outline", active: "business" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function CustomerLayout() {
  const { hydrating, token, user } = useAuth();
  const { ready } = usePermissions();
  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  if (user.role !== "customer") return <Redirect href="/role-home" />;
  if (!ready) return null;

  return (
    <Tabs backBehavior="history" screenOptions={{ headerShown: false }} tabBar={(props) => <GlassTabBar {...props} tabs={TABS} centerLabel="New" />}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}
