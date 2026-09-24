import React from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, spacing } from "@/src/theme/tokens";

type Order = {
  id: string;
  order_number: string;
  plant_name: string;
  grade: string;
  quantity: number;
  status: string;
  challan_number?: string | null;
};

export default function CustomerDocuments() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, loading, refetch } = useGet<{ orders: Order[] }>("/customer/orders");
  const rows = (data?.orders || []).filter((o) => o.challan_number || o.status === "DELIVERED");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}>
        <View><AppText variant="title">Documents</AppText><AppText variant="caption">Digital challans and proof-of-delivery records</AppText></View>
        {loading && !data ? <><Skeleton height={90} /><Skeleton height={90} /></> : null}
        {rows.map((o) => (
          <Pressable key={o.id} onPress={() => router.push(`/order/${o.id}` as any)}>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Ionicons name="document-text-outline" size={22} color={colors.brand} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{o.challan_number || o.order_number}</AppText>
                <AppText variant="caption">{o.order_number} · {o.grade} · {o.quantity} m³</AppText>
                <AppText variant="caption">{o.plant_name} · {o.status.replace(/_/g, " ")}</AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Card>
          </Pressable>
        ))}
        {data && rows.length === 0 ? <Card><AppText variant="bodyMuted">No delivery documents are available yet.</AppText></Card> : null}
      </ScrollView>
    </View>
  );
}
