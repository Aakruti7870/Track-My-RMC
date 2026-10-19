import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "@/src/components/ui/AppText";
import { WeeklyInsights } from "@/src/components/WeeklyInsights";
import { useGet } from "@/src/hooks/useApi";
import { OwnerGlass, useOwnerPalette } from "./OwnerUI";
function PlantOverview() {
  const { data } = useGet<{ plant_count: number; cards: Record<string, number> }>("/owner/home");
  const p = useOwnerPalette();
  return <View style={{ gap: 12 }}><OwnerGlass style={{ padding: 14, gap: 6 }}>
    <AppText color={p.text}>{data ? `${data.plant_count} connected plants` : "Plant overview unavailable"}</AppText>
    {data ? [["Ordered today", "ordered_qty", "m³"], ["Dispatched today", "dispatched_qty", "m³"], ["Delivered today", "delivered_qty", "m³"], ["Active transit mixers", "active_mixers", ""]].map(([label, key, unit]) => <AppText key={key} style={{ color: p.muted, fontSize: 12 }}>{label}: {data.cards[key] ?? "—"} {unit}</AppText>) : null}
  </OwnerGlass><WeeklyInsights /></View>;
}
/** Preserve the prior quantity metrics and weekly charts off the six-shortcut Home. */
export function OwnerInsights() {
  const [open, setOpen] = useState(false);
  const p = useOwnerPalette();
  return <View style={{ gap: 10 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}><OwnerGlass style={{ padding: 16 }}><AppText color={p.text}>Plant Overview & Weekly Insights {open ? "−" : "+"}</AppText></OwnerGlass></Pressable>{open ? <PlantOverview /> : null}</View>;
}
