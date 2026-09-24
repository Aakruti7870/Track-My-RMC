import React, { useState } from "react";
import { Pressable, StyleSheet, View, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Incident = { id: string; type: string; status: string; driver_name: string; vehicle?: string; order_number?: string; remark?: string; created_at?: string };

export default function OwnerIncidents() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { data, loading, error, reload } = useGet<{ incidents: Incident[] }>("/owner/incidents");
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = async (id: string) => {
    setBusy(id);
    try {
      await apiPost(`/owner/incidents/${id}/resolve`, token!);
      toast("Incident resolved", "success");
      reload();
    } catch (e: any) {
      toast(e.detail || "Failed", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="incidents-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">Incidents / SOS</AppText>
      </View>
      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : (
        <FlatList
          testID="incidents-list"
          data={data?.incidents || []}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          onRefresh={reload}
          refreshing={loading}
          renderItem={({ item }) => (
            <Card style={{ gap: spacing.sm }}>
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Ionicons name="warning" size={20} color={item.status === "OPEN" ? colors.error : colors.onSurfaceTertiary} />
                  <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.base, color: colors.onSurface }}>{item.type}</AppText>
                </View>
                <Badge label={item.status} status={item.status === "OPEN" ? "PENDING" : "DELIVERED"} />
              </View>
              <AppText variant="caption">{item.driver_name}{item.vehicle ? ` · ${item.vehicle}` : ""}{item.order_number ? ` · ${item.order_number}` : ""}</AppText>
              {item.remark ? <AppText variant="body">{item.remark}</AppText> : null}
              {item.status === "OPEN" ? (
                <Button testID={`resolve-${item.id}`} label="Acknowledge & Resolve" variant="outline" loading={busy === item.id} onPress={() => resolve(item.id)} />
              ) : null}
            </Card>
          )}
          ListEmptyComponent={<EmptyView icon="shield-checkmark-outline" title="All clear" subtitle="No driver incidents reported" />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
