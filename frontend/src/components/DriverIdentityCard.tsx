import React, { useState } from "react";
import { Image } from "expo-image";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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

const driverArtwork = require("../../assets/images/driver-identity-background.webp");

const appearance = {
  light: {
    ink: "#241B17", muted: "#544238", accent: "#8B4119", error: "#A02521",
    edge: "#AD75586B", field: "#FFFAF3EE", priorityField: "#FFF1E5EC",
    identity: "#FFF6EAE8", band: ["#FFE0C1F5", "#FFFAF0ED"],
  },
  dark: {
    ink: "#FFF4E8", muted: "#E4CEC0", accent: "#FFC38D", error: "#FFB6B2",
    edge: "#D6976F62", field: "#231D1AEF", priorityField: "#352820ED",
    identity: "#221B17E8", band: ["#57321EFA", "#231C19ED"],
  },
} as const;

const show = (value: string | null | undefined) => value?.trim() || "Not provided";
const contactText = (value: Contact) =>
  [value?.name, value?.phone].filter(Boolean).join(" · ") || "Not provided";
const formattedDate = (value: string | null | undefined) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Not provided";
  const [year, month, day] = value.split("-");
  return day + "/" + month + "/" + year;
};

/**
 * The entire nine-field card is visible immediately on Driver Home after login.
 * Layout, values, and themes are native and responsive; no personal data is baked into assets.
 */
export function DriverIdentityCard() {
  const { colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(0);
  const { data, loading, error, reload } = useGet<DriverIdentity>("/driver/identity");
  const palette = colors.isDark ? appearance.dark : appearance.light;
  const compact = width < 768;
  const readableWidth = (contentWidth || width - 48) / fontScale;
  const fieldWidth = readableWidth >= 650 ? "32%" : readableWidth >= 300 ? "49%" : "100%";

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
      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.backdrop, { height: compact ? 280 : 330 }]}
      >
        <Image
          testID="driver-identity-background"
          source={driverArtwork}
          contentFit="cover"
          contentPosition={{ left: compact ? "46%" : "45%", top: "36%" }}
          accessible={false}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={colors.isDark ? ["#21150EA0", "#1613172E"] : ["#78452870", "#FFE7CF15"]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[colors.surfaceSecondary + "00", colors.surfaceSecondary + "55", colors.surfaceSecondary]}
          locations={[0, 0.56, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <LinearGradient
        colors={palette.band}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.brandBand, { borderBottomColor: palette.edge }]}
      >
        <View style={styles.brandIdentity}>
          <Ionicons name="shield-checkmark-outline" size={18} color={palette.accent} accessible={false} />
          <AppText color={palette.ink} style={styles.brandText}>TRACKMYRMC</AppText>
        </View>
        <AppText accessibilityRole="header" color={palette.ink} style={styles.bandTitle}>DIGITAL DRIVER CARD</AppText>
      </LinearGradient>

      <View style={[styles.body, !compact && styles.wideBody]}>
        <View style={[styles.intro, !compact && styles.wideIntro]}>
          <View
            style={[
              styles.identityPane,
              readableWidth >= 250 && (compact ? styles.compactIdentityWithArtwork : styles.identityWithArtwork),
              { backgroundColor: palette.identity, borderColor: palette.edge },
            ]}
          >
            <View style={styles.recordLine}>
              <Ionicons name="lock-closed-outline" size={12} color={palette.muted} accessible={false} />
              <AppText color={palette.muted} style={styles.recordText}>Plant-managed records · Read only</AppText>
            </View>
            {data ? (
              <View style={[styles.personRow, readableWidth >= 630 && styles.personRowWide]}>
                <View style={styles.personName}>
                  <AppText color={palette.muted} style={styles.nameLabel}>DRIVER NAME</AppText>
                  <AppText color={palette.ink} style={styles.driverName}>{show(data.driver_name)}</AppText>
                </View>
                <View style={[styles.tmBadge, { backgroundColor: colors.brandSoft, borderColor: palette.edge }]}>
                  <AppText color={colors.onBrandSoft} style={styles.tmLabel}>ASSIGNED TM</AppText>
                  <AppText color={palette.ink} style={styles.tmNumber}>{show(data.tm_number)}</AppText>
                </View>
              </View>
            ) : null}
            {loading && !data ? <AppText color={palette.muted}>Loading driver information…</AppText> : null}
            {error ? (
              <View style={styles.error}>
                <AppText color={palette.error}>{error}</AppText>
                <Pressable accessibilityRole="button" onPress={reload} style={styles.retry} testID="driver-identity-retry">
                  <AppText color={palette.accent}>Retry</AppText>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
        {data ? (
          <View testID="driver-identity-full-details" style={styles.detailSection} onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
            <View style={styles.grid}>
              {fields.map((field, index) => (
                <View key={field.label} style={[styles.field, {
                  width: fieldWidth,
                  borderColor: palette.edge,
                  backgroundColor: index < 6 ? palette.priorityField : palette.field,
                }]}>
                  <View style={styles.fieldHeading}>
                    <Ionicons name={field.icon} size={16} color={palette.accent} accessible={false} />
                    <AppText color={palette.muted} style={styles.fieldLabel}>{field.label}</AppText>
                  </View>
                  <AppText color={field.value === "Not provided" ? palette.muted : palette.ink} style={styles.fieldValue}>
                    {field.value}
                  </AppText>
                </View>
              ))}
            </View>
            <AppText color={palette.muted} style={styles.licenceDisclaimer}>
              Licence information is supplied by the plant; it is not independently government-verified.
            </AppText>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0 },
  brandBand: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandIdentity: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  brandText: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.3, flexShrink: 1 },
  bandTitle: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15, letterSpacing: 0.25, flexShrink: 1, textAlign: "right" },
  body: { padding: 12, gap: 10 },
  wideBody: { padding: 18, gap: 12 },
  intro: { minHeight: 155, justifyContent: "center" },
  wideIntro: { minHeight: 168 },
  identityPane: {
    borderRadius: radius.md, borderWidth: 1, padding: 10, gap: 8,
    alignSelf: "flex-start", width: "100%",
  },
  identityWithArtwork: { width: "64%", maxWidth: 520 },
  compactIdentityWithArtwork: { width: "68%", maxWidth: 370 },
  recordLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  recordText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15, flexShrink: 1 },
  personRow: { gap: 8 },
  personRowWide: { flexDirection: "row", alignItems: "center" },
  personName: { flexShrink: 1, minWidth: 0, gap: 2 },
  nameLabel: { fontFamily: fonts.semibold, fontSize: 10, lineHeight: 14, letterSpacing: 0.35 },
  driverName: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  tmBadge: { alignSelf: "flex-start", flexShrink: 1, maxWidth: "100%", paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, gap: 2 },
  tmLabel: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 14, letterSpacing: 0.3 },
  tmNumber: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  detailSection: { gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "2%", rowGap: 7 },
  field: { minWidth: 0, borderRadius: radius.sm, borderWidth: 1, padding: 9, minHeight: 59, gap: 4 },
  fieldHeading: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  fieldLabel: { flex: 1, fontFamily: fonts.bold, fontSize: 10, lineHeight: 15, letterSpacing: 0.1 },
  fieldValue: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  licenceDisclaimer: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  error: { gap: 4 },
  retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
});
