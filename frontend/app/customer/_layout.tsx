import React from "react";
import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { GlassTabBar, TabDef } from "@/src/components/GlassTabBar";
import { usePermissions } from "@/src/permissions/PermissionProvider";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getThemedCanvasColor } from "@/src/theme/sceneBackground";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "orders", label: "Orders", icon: "cube-outline", active: "cube" },
  { name: "plan", label: "Plan", icon: "calendar-outline", active: "calendar" },
  { name: "supply", label: "Supply", icon: "business-outline", active: "business" },
  { name: "more", label: "Account", icon: "person-outline", active: "person" },
];

export default function CustomerLayout() {
  const { hydrating, token, user } = useAuth();
  const { ready } = usePermissions();
  const { colors } = useTheme();
  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  if (user.role !== "customer") return <Redirect href="/role-home" />;
  if (!ready) return null;

  return (
    <Tabs backBehavior="history" screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: getThemedCanvasColor(colors) } }} tabBar={(props) => <GlassTabBar {...props} tabs={TABS} hideCenterAction />}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}
