import React from "react";
import { View } from "react-native";
import { AppText } from "@/src/components/ui/AppText";
import { WeeklyInsights } from "@/src/components/WeeklyInsights";
import { useGet } from "@/src/hooks/useApi";
import { OwnerGlass, useOwnerPalette } from "./OwnerUI";

/** Home Quick Access owns the single Insights toggle. The details open in place. */
export function OwnerInsights({ expanded }: { expanded: boolean }) {
  if (!expanded) return null;
  return <PlantOverview />;
}
function PlantOverview() {
  const { data } = useGet<{ plant_count: number; cards: Record<string, number> }>("/owner/home");
  const p = useOwnerPalette();
  return <View testID="owner-expanded-insights" style={{ gap: 10 }}>
    <OwnerGlass style={{ padding: 14, gap: 6 }}>
      <AppText color={p.text}>{data ? `${data.plant_count} connected plants` : "Plant overview unavailable"}</AppText>
      {data ? [["Ordered today", "ordered_qty", "m³"], ["Dispatched today", "dispatched_qty", "m³"], ["Delivered today", "delivered_qty", "m³"], ["Active transit mixers", "active_mixers", ""]].map(([label, key, unit]) => (
        <AppText key={key} style={{ color: p.muted, fontSize: 12 }}>{label}: {data.cards[key] ?? "—"} {unit}</AppText>
      )) : null}
    </OwnerGlass>
    <WeeklyInsights />
  </View>;
}
