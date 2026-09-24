import React, { useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import {
  getNotificationPermissionStatus,
  registerPushDevice,
} from "@/src/notifications/pushClient";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Feed = { unread: number; items: { id: string; event: string; title: string; body: string; read: boolean; created_at: string | null }[] };

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  new_order: "cube-outline", order_approved: "checkmark-circle-outline", order_rejected: "close-circle-outline",
  dispatched: "navigate-outline", delivered: "checkmark-done-outline", trip_assigned: "bus-outline",
  sos: "warning-outline", sos_resolved: "shield-checkmark-outline", kyc: "id-card-outline",
};

export default function Notifications() {
  const { colors, scheme } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, loading, refetch } = useGet<Feed>("/notifications");
  const [permission, setPermission] = useState<string | null>(null);
  const [permissionBusy, setPermissionBusy] = useState(false);

  useEffect(() => {
    void getNotificationPermissionStatus()
      .then(setPermission)
      .catch(() => setPermission(null));
  }, []);

  const markAll = async () => {
    await apiPost("/notifications/read-all", token!);
    refetch();
  };
  const openOne = async (id: string) => {
    await apiPost(`/notifications/${id}/read`, token!);
    refetch();
  };

  const enableDeviceNotifications = async () => {
    if (!token) return;
    setPermissionBusy(true);
    try {
      await registerPushDevice(token, true);
      const next = await getNotificationPermissionStatus();
      setPermission(next);
      if (next !== "granted") await Linking.openSettings();
    } finally {
      setPermissionBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="notif-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title" style={{ flex: 1 }}>Notifications</AppText>
        {data && data.unread > 0 ? (
          <Pressable testID="notif-read-all" onPress={markAll}>
            <AppText variant="label" color={colors.brand}>Mark all read</AppText>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}>
        {permission && permission !== "granted" ? (
          <Card style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
              <Ionicons name="notifications-outline" size={22} color={colors.brand} />
              <AppText variant="heading" style={{ flex: 1 }}>Device notifications are optional</AppText>
            </View>
            <AppText variant="bodyMuted">
              Enable them if you want Android alerts for order status, assigned trips, KYC decisions and safety updates. The in-app notification feed works even if you keep device notifications off.
            </AppText>
            <Button
              label="Enable device notifications"
              onPress={enableDeviceNotifications}
              loading={permissionBusy}
            />
          </Card>
        ) : null}

        {loading && !data ? (
          <><Skeleton height={70} style={{ borderRadius: radius.lg }} /><Skeleton height={70} style={{ borderRadius: radius.lg }} /></>
        ) : data && data.items.length === 0 ? (
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
            <Ionicons name="notifications-off-outline" size={30} color={colors.onSurfaceTertiary} />
            <AppText variant="bodyMuted">You&apos;re all caught up</AppText>
          </Card>
        ) : (
          data?.items.map((n) => (
            <Pressable key={n.id} testID={`notif-${n.id}`} onPress={() => !n.read && openOne(n.id)}>
              <Card style={{ flexDirection: "row", gap: spacing.md, opacity: n.read ? 0.6 : 1 }}>
                <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
                  <Ionicons name={ICONS[n.event] || "notifications-outline"} size={18} color={colors.onBrandSoft} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{n.title}</AppText>
                  <AppText variant="caption">{n.body}</AppText>
                  {n.created_at ? <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }}>{new Date(n.created_at).toLocaleString()}</AppText> : null}
                </View>
                {!n.read ? <View style={[styles.dot, { backgroundColor: colors.brand }]} /> : null}
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, alignSelf: "center" },
});