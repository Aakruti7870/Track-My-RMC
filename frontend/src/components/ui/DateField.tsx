import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { control, spacing } from "@/src/theme/tokens";
import { AppText } from "./AppText";
import { Button } from "./Button";

export function localDate(d = new Date()) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

type Props = {
  label: string;
  date: string;
  onChange: (date: string) => void;
  required?: boolean;
  error?: string;
  calendarTestID?: string;
};

export function DateField({ label, date, onChange, required, error, calendarTestID }: Props) {
  const { colors, reduceMotion } = useTheme();
  const trigger = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const today = localDate();
  const days = Array.from({ length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate() }, (_, i) => i + 1);
  const blanks = Array.from({ length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay() }, (_, i) => i);
  const close = () => setOpen(false);
  const show = () => {
    const [year, month] = (date || today).split("-").map(Number);
    setCalendarMonth(new Date(year, month - 1, 1));
    setOpen(true);
  };

  return (
    <View style={styles.field}>
      <AppText variant="label">{label}{required ? " *" : ""}</AppText>
      <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={label + ": " + (date || "Choose date")}
        accessibilityState={{ expanded: open }} accessibilityHint={error}
        onPress={show} style={[styles.trigger, { borderColor: error ? colors.error : colors.controlOutline, backgroundColor: colors.surfaceSecondary }]}>
        <Ionicons name="calendar-outline" size={20} color={colors.onSurfaceTertiary} />
        <AppText style={styles.value}>{date || "Choose date"}</AppText>
      </Pressable>
      {error ? <AppText variant="caption" accessibilityLiveRegion="polite" color={colors.error}>{error}</AppText> : null}
      <Modal visible={open} transparent animationType={reduceMotion ? "none" : "fade"}
        onRequestClose={close} onDismiss={() => trigger.current?.focus()}>
        <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "center", padding: spacing.xs }}>
          <ScrollView
            testID={calendarTestID}
            accessibilityViewIsModal
            onAccessibilityEscape={() => close()}
            style={{
              flexGrow: 0, flexShrink: 1, width: "100%", maxWidth: 420, maxHeight: "100%",
              alignSelf: "center", borderRadius: 18, borderWidth: 1, borderColor: colors.divider,
              backgroundColor: colors.surfaceElevated,
            }}
            contentContainerStyle={{ padding: spacing.xs, gap: spacing.md }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous month"
                onPress={() => setCalendarMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                style={{ width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
              </Pressable>
              <AppText variant="heading" center style={{ flex: 1, minWidth: 0 }}>
                {calendarMonth.toLocaleString("en-IN", { month: "long", year: "numeric" })}
              </AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Next month"
                onPress={() => setCalendarMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                style={{ width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chevron-forward" size={24} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((weekday, index) => <AppText key={index}>{weekday}</AppText>)}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {blanks.map(index => <View key={`blank-${index}`} style={{ width: "14.28%", minHeight: 44 }} />)}
              {days.map(day => {
                const value = localDate(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
                const disabled = value < today;
                const selected = value === date;
                return (
                  <Pressable key={day} accessibilityRole="button" accessibilityLabel={value}
                    accessibilityState={{ disabled, selected }} disabled={disabled}
                    onPress={() => { onChange(value); close(); }}
                    style={{
                      width: "14.28%", minHeight: 44, alignItems: "center", justifyContent: "center",
                      backgroundColor: selected ? colors.brandSoft : "transparent",
                      opacity: disabled ? 0.55 : 1,
                    }}>
                    <AppText color={selected ? colors.onBrandSoft : colors.onSurface}>{day}</AppText>
                  </Pressable>
                );
              })}
            </View>
            <Button label="Close Calendar" variant="outline" onPress={() => close()} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  trigger: { minHeight: control.buttonHeightSmall, flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.sm, borderWidth: 1, borderRadius: 12 },
  value: { flex: 1, minWidth: 0 },
});
