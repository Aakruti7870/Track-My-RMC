import React from "react";
import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { GlassTabBar, TabDef } from "@/src/components/GlassTabBar";

const TABS: TabDef[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "trips", label: "Trips", icon: "navigate-outline", active: "navigate" },
  { name: "attendance", label: "Attendance", icon: "time-outline", active: "time" },
  { name: "more", label: "More", icon: "grid-outline", active: "grid" },
];

export default function DriverLayout() {
  const { hydrating, token, user } = useAuth();
  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  if (user.role !== "driver") return <Redirect href="/role-home" />;

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <GlassTabBar {...props} tabs={TABS} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}
