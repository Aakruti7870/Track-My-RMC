import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  currentLocationFailureMessage,
  getCurrentDeviceLocation,
} from "@/src/location/currentLocation";
import { fonts, fontSize, spacing } from "@/src/theme/tokens";

type Att = { date: string; check_in: string | null; check_out: string | null };

function fmt(t: string | null) {
  if (!t) return "—";
  return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Attendance() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { data, reload } = useGet<Att>("/driver/attendance");
  const [busy, setBusy] = useState(false);

  const act = async (path: string, msg: string) => {
    setBusy(true);
    try {
      const location = await getCurrentDeviceLocation();
      if (!location.ok) {
        toast(currentLocationFailureMessage(location), "error");
        return;
      }

      await apiPost(path, token!, {
        lat: location.location.lat,
        lng: location.location.lng,
      });
      toast(msg, "success");
      reload();
    } catch (e: any) {
      toast(e.detail || "Failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const checkedIn = !!data?.check_in && !data?.check_out;
  const done = !!data?.check_out;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.titleRow}><AppText variant="title">Attendance</AppText></View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Card style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl }}>
          <View style={[styles.circle, { backgroundColor: done ? colors.surfaceTertiary : checkedIn ? colors.success : colors.warning }]}>
            <Ionicons name={done ? "checkmark-done" : checkedIn ? "walk" : "time-outline"} size={34} color={colors.isDark ? "#121212" : "#fff"} />
          </View>
          <AppText variant="heading">{done ? "Shift complete" : checkedIn ? "On Duty" : "Not checked in"}</AppText>
          <AppText variant="caption">{data?.date}</AppText>
          <View style={styles.times}>
            <View style={styles.timeBox}><AppText variant="caption">Check-in</AppText><AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.onSurface }}>{fmt(data?.check_in || null)}</AppText></View>
            <View style={styles.timeBox}><AppText variant="caption">Check-out</AppText><AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.onSurface }}>{fmt(data?.check_out || null)}</AppText></View>
          </View>
        </Card>
        {!checkedIn && !done ? (
          <Button testID="checkin-btn" label="Check In" loading={busy} onPress={() => act("/driver/attendance/checkin", "Checked in")} icon={<Ionicons name="log-in-outline" size={18} color={colors.onBrand} />} />
        ) : null}
        {checkedIn ? (
          <Button testID="checkout-btn" label="Check Out" variant="outline" loading={busy} onPress={() => act("/driver/attendance/checkout", "Checked out")} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  circle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  times: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm },
  timeBox: { alignItems: "center", gap: 2 },
});
