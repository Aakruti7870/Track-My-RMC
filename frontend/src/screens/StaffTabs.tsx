import React from "react";
import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { GlassTabBar, TabDef } from "@/src/components/GlassTabBar";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getThemedSceneStyle } from "@/src/theme/sceneBackground";

/** Shared role tab shell for all staff roles. Guards the role server-truth. */
export function StaffTabs({ role, tabs }: { role: string; tabs: TabDef[] }) {
  const { hydrating, token, user } = useAuth();
  const { colors } = useTheme();
  if (hydrating) return null;
  if (!token || !user) return <Redirect href="/login" />;
  if (user.role !== role) return <Redirect href="/role-home" />;

  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: getThemedSceneStyle(colors) }} tabBar={(props) => <GlassTabBar {...props} tabs={tabs} />}>
      {tabs.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}
