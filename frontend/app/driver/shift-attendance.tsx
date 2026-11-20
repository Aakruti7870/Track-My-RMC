import React, { useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { ErrorView } from "@/src/components/StateViews";
import { Card } from "@/src/components/ui/Card";
import { fonts, fontSize, spacing } from "@/src/theme/tokens";

type Att = { date: string; check_in: string | null; check_out: string | null };

function fmt(t: string | null) {
  if (!t) return "—";
  return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Attendance() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<Att>("/driver/attendance");
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const checkedIn = !!data?.check_in && !data?.check_out;
  const done = !!data?.check_out;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={styles.titleRow}><AppText variant="title">Attendance</AppText></View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 96 + insets.bottom }]}>
        {error && !data ? (
          <ErrorView message={error} onRetry={reload} />
        ) : loading && !data ? (
          <AppText variant="caption">Loading attendance…</AppText>
        ) : (
          <Card style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl }}>
            <View style={[styles.circle, { backgroundColor: done ? colors.surfaceTertiary : checkedIn ? colors.success : colors.warning }]}>
              <Ionicons name={done ? "checkmark-done" : checkedIn ? "walk" : "time-outline"} size={34} color={done ? colors.onSurface : "#121212"} />
            </View>
            <AppText variant="heading">{done ? "Shift complete" : checkedIn ? "On Duty" : "Not checked in"}</AppText>
            <AppText variant="caption">{data?.date}</AppText>
            <View style={styles.times}>
              <View style={styles.timeBox}><AppText variant="caption">Check-in</AppText><AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.onSurface }}>{fmt(data?.check_in || null)}</AppText></View>
              <View style={styles.timeBox}><AppText variant="caption">Check-out</AppText><AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.lg, color: colors.onSurface }}>{fmt(data?.check_out || null)}</AppText></View>
            </View>
            <AppText variant="caption" center>Check in and out from Home.</AppText>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  circle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  content: { width: "100%", maxWidth: 620, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  times: { width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.lg },
  timeBox: { minWidth: 0, flexBasis: 88, alignItems: "center", gap: 2 },
});
