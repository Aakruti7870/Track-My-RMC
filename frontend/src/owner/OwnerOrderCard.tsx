import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { Order } from "@/src/domain/order";
import { AppText } from "@/src/components/ui/AppText";
import { fonts } from "@/src/theme/tokens";
import { OwnerGlass, useOwnerPalette } from "./OwnerUI";
const LABELS: Record<string, string> = { PENDING: "Pending Approval", ACCEPTED: "Approved", IN_PRODUCTION: "In Production", PRODUCTION_COMPLETE: "Produced", EN_ROUTE: "Dispatched", UNLOADING: "Unloading", DELIVERED: "Delivered" };
export const OwnerOrderCard = React.memo(function OwnerOrderCard({ order }: { order: Order & { customer_name?: string } }) {
  const p = useOwnerPalette();
  const router = useRouter();
  const status = order.status.toUpperCase();
  const tone = ["REJECTED", "CANCELLED"].includes(status) ? (p.dark ? "#FFA49D" : "#AB3029") : status === "PENDING" ? (p.dark ? "#FFD28E" : "#9B4900") : ["DELIVERED", "DISPATCHED", "EN_ROUTE"].includes(status) ? (p.dark ? "#80E6B2" : "#167445") : (p.dark ? "#92CBFF" : "#1F609E");
  return <Pressable testID={`order-card-${order.order_number}`} accessibilityRole="button" accessibilityLabel={`Order ${order.order_number}, ${LABELS[status] ?? status.replace(/_/g, " ")}, ${order.customer_name ?? ""}, ${order.site_name}`} onPress={() => router.push({ pathname: "/order/[id]", params: { id: order.id } })}>
    <OwnerGlass style={{ padding: 13, gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 9, alignItems: "center" }}>
        <View style={{ width: 38, height: 40, borderRadius: 12, backgroundColor: `${tone}18`, alignItems: "center", justifyContent: "center" }}><Ionicons name="document-text" size={25} color={tone} /></View>
        <AppText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.bold, fontSize: 13, color: p.text }}>{order.order_number}</AppText>
        <View style={{ backgroundColor: `${tone}18`, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, maxWidth: "48%" }}><AppText style={{ fontSize: 10, color: tone }}>{LABELS[status] ?? status.replace(/_/g, " ")}</AppText></View>
      </View>
      <View style={{ paddingLeft: 47, gap: 5 }}>
        {order.customer_name ? <AppText style={{ fontSize: 13, color: p.text }}>{order.customer_name}</AppText> : null}
        <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}><Ionicons name="location-outline" color={p.muted} size={12} /><AppText numberOfLines={2} style={{ flex: 1, fontSize: 10, color: p.muted }}>{[order.site_name, order.site_address].filter(Boolean).join(", ")}</AppText><Ionicons name="chevron-forward" color={p.text} size={17} /></View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 }}>
          {([['cube-outline', order.grade], ['bus-outline', `${order.quantity} m³`], ['calendar-outline', order.delivery_date?.slice(0, 10)]] as const).map(([icon, value]) => <View key={icon} style={{ flexDirection: "row", gap: 4, alignItems: "center" }}><Ionicons name={icon} size={13} color={p.muted} /><AppText style={{ fontSize: 10, color: p.muted }}>{value}</AppText></View>)}
        </View>
      </View>
    </OwnerGlass>
  </Pressable>;
});
