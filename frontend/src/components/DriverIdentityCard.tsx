import React from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { fonts, radius, spacing } from "@/src/theme/tokens";

type Contact = { name: string | null; phone: string | null } | null;
type DriverIdentity = {
  success: boolean;
  plant_name: string | null;
  plant_address: string | null;
  tm_number: string | null;
  driver_name: string;
  blood_group: string | null;
  emergency_contact_1: Contact;
  emergency_contact_2: Contact;
  employment: {
    employee_id: string | null;
    company_joining_date: string | null;
    total_driving_experience_months: number | null;
    total_driving_experience_display: string;
  };
};
const show = (value: string | null | undefined) => value?.trim() || "Not provided";
const contactText = (value: Contact) => [value?.name, value?.phone].filter(Boolean).join(" · ") || "Not provided";
const formattedDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Not provided";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
};

export function DriverIdentityCard() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { data, loading, error, reload } = useGet<DriverIdentity>("/driver/identity");
  const wide = width >= 720;
  const fields = data ? [
    ["Plant Name", show(data.plant_name)],
    ["TM Number", show(data.tm_number)],
    ["Driver Name", show(data.driver_name)],
    ["Blood Group", show(data.blood_group)],
    ["Emergency Contact 1", contactText(data.emergency_contact_1)],
    ["Emergency Contact 2", contactText(data.emergency_contact_2)],
  ] : [];
  const employment = data ? [
    ["EMPLOYEE ID", show(data.employment.employee_id)],
    ["COMPANY JOINING DATE", formattedDate(data.employment.company_joining_date)],
    ["TOTAL DRIVING EXPERIENCE", show(data.employment.total_driving_experience_display)],
  ] : [];

  return (
    <Card testID="driver-identity-card" style={[styles.card, {
      backgroundColor: colors.surfaceSecondary,
      borderColor: colors.isDark ? "rgba(255,154,61,0.48)" : colors.borderStrong,
    }]}>
      <View style={styles.header}>
        <Ionicons name="id-card-outline" size={28} color={colors.brand} />
        <View style={{ flex: 1 }}>
          <AppText style={[styles.title, { color: colors.onSurface }]}>Driver Information</AppText>
          <AppText variant="caption">Verified plant records · Read only</AppText>
        </View>
      </View>
      {loading && !data ? <AppText variant="bodyMuted">Loading driver information…</AppText> : null}
      {error ? (
        <View style={styles.error}>
          <AppText style={{ color: colors.error }}>{error}</AppText>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.retry} testID="driver-identity-retry">
            <AppText color={colors.brand}>Retry</AppText>
          </Pressable>
        </View>
      ) : null}
      {data ? (
        <>
          <View style={styles.grid}>
            {fields.map(([label, value]) => (
              <View key={label} style={[styles.field, { width: wide ? "32.3%" : "49%", borderColor: colors.border }]}>
                <AppText variant="caption">{label}</AppText>
                <AppText style={[styles.value, { color: colors.onSurface }]}>{value}</AppText>
              </View>
            ))}
          </View>
          <View style={styles.employment}>
            {employment.map(([label, value]) => (
              <View key={label} style={[styles.employmentField, {
                width: wide ? "32.3%" : "100%",
                backgroundColor: colors.brandSoft,
                borderColor: colors.isDark ? "rgba(255,154,61,0.30)" : colors.border,
              }]}>
                <AppText style={[styles.caption, { color: colors.onSurfaceSecondary }]}>{label}</AppText>
                <AppText style={[styles.value, { color: colors.onSurface }]}>{value}</AppText>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
}
const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: 14, borderRadius: radius.lg },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  field: { minHeight: 65, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 5, gap: 3 },
  value: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  employment: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  employmentField: { minHeight: 64, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 3 },
  caption: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.3 },
  error: { gap: 8 },
  retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
});
