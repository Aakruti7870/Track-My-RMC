import { StyleSheet, View } from "react-native";

import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import type { HomeAttendance } from "@/src/hooks/useHomeAttendance";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

export function HomeAttendanceCard({ attendance }: { attendance: HomeAttendance }) {
  const { colors } = useTheme();
  const { loading, error, next, checkedIn, complete, pending, record, reload } = attendance;
  const status = error ?? (loading ? "Loading attendance…"
    : complete ? "Shift complete" : checkedIn ? "Checked in" : "Ready to check in");

  return (
    <Card testID="home-attendance-card" style={styles.card}>
      <View style={styles.row}>
        <AppText accessibilityRole="header" variant="heading" style={styles.title}>Attendance</AppText>
        {error ? <Button testID="home-attendance-retry" label="Retry" size="sm" variant="outline" fullWidth={false}
          onPress={() => { void reload(); }} /> : null}
      </View>
      <AppText testID="home-attendance-status" accessibilityLiveRegion="polite" variant="caption"
        color={error ? colors.error : colors.onSurfaceSecondary}>{status}</AppText>
      <View style={styles.actions}>
        <Button testID="home-attendance-check-in" label="Check In" size="sm" disabled={next !== "in" || pending !== null}
          loading={pending === "in"} loadingLabel="Checking in…" style={styles.action} onPress={() => { void record("in"); }} />
        <Button testID="home-attendance-check-out" label="Check Out" size="sm" variant="outline" disabled={next !== "out" || pending !== null}
          loading={pending === "out"} loadingLabel="Checking out…" style={styles.action} onPress={() => { void record("out"); }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs, padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  action: { flexGrow: 1, flexBasis: 112 },
});
