import React, { useState } from "react";
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
  driving_licence_number: string | null;
  driving_licence_valid_until: string | null;
  emergency_contact_1: Contact;
  emergency_contact_2: Contact;
  employment: {
    employee_id: string | null;
    company_joining_date: string | null;
    total_driving_experience_months: number | null;
    total_driving_experience_display: string;
  };
};

type Detail = { label: string; value: string; icon: keyof typeof Ionicons.glyphMap };

const show = (value: string | null | undefined) => value?.trim() || "Not provided";
const contactText = (value: Contact) =>
  [value?.name, value?.phone].filter(Boolean).join(" · ") || "Not provided";
const formattedDate = (value: string | null | undefined) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Not provided";
  const [year, month, day] = value.split("-");
  return day + "/" + month + "/" + year;
};

/**
 * Compact by default on phones. The entire nine-field plant record remains
 * accessible in-place; no personal data is baked into an image asset.
 */
export function DriverIdentityCard() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { data, loading, error, reload } = useGet<DriverIdentity>("/driver/identity");
  const [expanded, setExpanded] = useState(false);
  const wide = width >= 720;
  const narrow = width < 360;
  const detailsOpen = wide || expanded;

  const fields: Detail[] = data ? [
    { label: "PLANT NAME", value: show(data.plant_name), icon: "business-outline" },
    { label: "BLOOD GROUP", value: show(data.blood_group), icon: "water-outline" },
    { label: "EMERGENCY CONTACT 1", value: contactText(data.emergency_contact_1), icon: "call-outline" },
    { label: "DRIVING LICENCE NUMBER", value: show(data.driving_licence_number), icon: "card-outline" },
    { label: "VALIDITY", value: formattedDate(data.driving_licence_valid_until), icon: "calendar-outline" },
    { label: "EMERGENCY CONTACT 2", value: contactText(data.emergency_contact_2), icon: "call-outline" },
    { label: "EMPLOYEE ID", value: show(data.employment.employee_id), icon: "id-card-outline" },
    { label: "COMPANY JOINING DATE", value: formattedDate(data.employment.company_joining_date), icon: "calendar-outline" },
    { label: "TOTAL DRIVING EXPERIENCE", value: show(data.employment.total_driving_experience_display), icon: "speedometer-outline" },
  ] : [];

  return (
    <Card
      testID="driver-identity-card"
      padded={false}
      style={[styles.card, {
        backgroundColor: colors.surfaceSecondary,
        borderColor: colors.isDark ? colors.borderStrong : colors.border,
      }]}
    >
      <View style={[styles.brandBand, { backgroundColor: colors.brandSoft }]}>
        <View style={styles.brandIdentity}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.brand} />
          <AppText style={[styles.brandText, { color: colors.onSurface }]}>TRACKMYRMC</AppText>
        </View>
        <AppText style={[styles.bandTitle, { color: colors.onSurfaceSecondary }]}>DIGITAL DRIVER CARD</AppText>
      </View>

      <View style={styles.body}>
        <View style={styles.recordLine}>
          <Ionicons name="lock-closed-outline" size={12} color={colors.onSurfaceTertiary} />
          <AppText style={styles.recordText}>Plant-managed records · Read only</AppText>
        </View>

        {data ? (
          <>
            <View style={styles.personRow}>
              <View style={styles.personName}>
                <AppText style={styles.nameLabel}>DRIVER NAME</AppText>
                <AppText style={[styles.driverName, { color: colors.onSurface }]} numberOfLines={2}>
                  {show(data.driver_name)}
                </AppText>
              </View>
              <View style={[styles.tmBadge, { backgroundColor: colors.brandSoft, borderColor: colors.brand }]}>
                <AppText style={[styles.tmLabel, { color: colors.onBrandSoft }]}>ASSIGNED TM</AppText>
                <AppText style={[styles.tmNumber, { color: colors.onSurface }]} numberOfLines={2}>
                  {show(data.tm_number)}
                </AppText>
              </View>
            </View>

            <View style={[styles.plantSummary, { backgroundColor: colors.surfaceTertiary }]}>
              <Ionicons name="business-outline" size={17} color={colors.brand} />
              <AppText style={[styles.plantText, { color: colors.onSurface }]} numberOfLines={2}>
                {show(data.plant_name)}
              </AppText>
            </View>

            {!wide ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                testID="driver-identity-toggle-details"
                onPress={() => setExpanded(current => !current)}
                style={[styles.toggle, { borderColor: colors.border }]}
              >
                <AppText style={[styles.toggleLabel, { color: colors.brand }]}>
                  {expanded ? "Hide Driver Card Details" : "View Full Driver Card"}
                </AppText>
                <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={17} color={colors.brand} />
              </Pressable>
            ) : null}

            {detailsOpen ? (
              <View testID="driver-identity-full-details" style={styles.detailSection}>
                <View style={[styles.detailsDivider, { backgroundColor: colors.divider }]} />
                <View style={styles.grid}>
                  {fields.map(field => (
                    <View
                      key={field.label}
                      style={[styles.field, {
                        width: wide ? "32.3%" : narrow ? "100%" : "48.6%",
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceElevated,
                      }]}
                    >
                      <View style={styles.fieldHeading}>
                        <Ionicons name={field.icon} size={16} color={colors.brand} />
                        <AppText style={[styles.fieldLabel, { color: colors.onSurfaceTertiary }]}>
                          {field.label}
                        </AppText>
                      </View>
                      <AppText style={[styles.fieldValue, {
                        color: field.value === "Not provided" ? colors.onSurfaceTertiary : colors.onSurface,
                      }]}>
                        {field.value}
                      </AppText>
                    </View>
                  ))}
                </View>
                <AppText style={styles.licenceDisclaimer}>
                  Licence information is supplied by the plant; it is not independently government-verified.
                </AppText>
              </View>
            ) : null}
          </>
        ) : null}

        {loading && !data ? <AppText variant="bodyMuted">Loading driver information…</AppText> : null}
        {error ? (
          <View style={styles.error}>
            <AppText style={{ color: colors.error }}>{error}</AppText>
            <Pressable accessibilityRole="button" onPress={reload} style={styles.retry} testID="driver-identity-retry">
              <AppText color={colors.brand}>Retry</AppText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  brandBand: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    minHeight: 36, paddingHorizontal: 12, paddingVertical: 7, gap: spacing.sm,
  },
  brandIdentity: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  brandText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.3 },
  bandTitle: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.25, flexShrink: 1, textAlign: "right" },
  body: { padding: 12, gap: 9 },
  recordLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  recordText: { fontFamily: fonts.medium, fontSize: 10, color: "#767D86", lineHeight: 14 },
  personRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  personName: { flex: 1, minWidth: 0, gap: 2 },
  nameLabel: { fontFamily: fonts.semibold, fontSize: 10, color: "#767D86", letterSpacing: 0.35 },
  driverName: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, flexShrink: 1 },
  tmBadge: { maxWidth: "45%", minWidth: 88, paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, gap: 2 },
  tmLabel: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.4 },
  tmNumber: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, textAlign: "right" },
  plantSummary: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 8, borderRadius: radius.sm },
  plantText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, flex: 1 },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, borderWidth: 1, borderRadius: radius.sm },
  toggleLabel: { fontFamily: fonts.semibold, fontSize: 12 },
  detailSection: { gap: 10 },
  detailsDivider: { height: StyleSheet.hairlineWidth },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  field: { borderRadius: radius.sm, borderWidth: 1, padding: 9, minHeight: 65, gap: 5 },
  fieldHeading: { flexDirection: "row", alignItems: "center", gap: 5 },
  fieldLabel: { flex: 1, fontFamily: fonts.bold, fontSize: 10, lineHeight: 13, letterSpacing: 0.1 },
  fieldValue: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  licenceDisclaimer: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, color: "#767D86" },
  error: { gap: 8 },
  retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
});
