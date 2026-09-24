import React from "react";
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";
import { AppText } from "./AppText";

/**
 * Premium map fallback used while a native/browser map is unavailable.
 * It never pretends to be a live map; actual map state still comes from the
 * platform integration and EXPO_PUBLIC_GOOGLE_MAPS_KEY.
 */
export function MapPlaceholder({
  pins = 0,
  label = "Live map",
  style,
  compact = false,
}: {
  pins?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const mapsConfigured = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY);
  const isWeb = Platform.OS === "web";
  const mapAvailable = isWeb || mapsConfigured;
  const statusLabel = isWeb ? "Open in Android app" : mapsConfigured ? "Map ready" : "Maps not configured";
  const grid = colors.isDark ? "rgba(255,255,255,0.045)" : "rgba(17,19,21,0.045)";

  return (
    <View style={[styles.wrap, { borderColor: colors.border, shadowColor: colors.shadow }, style]}>
      <LinearGradient
        colors={colors.isDark ? ["#172031", "#10151E", "#0C1017"] : ["#F8F8F5", "#ECEDE9", "#F7F7F4"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.road, styles.roadOne, { borderColor: colors.brand + "18" }]} />
      <View style={[styles.road, styles.roadTwo, { borderColor: colors.onSurfaceTertiary + "14" }]} />
      {[...Array(6)].map((_, index) => (
        <View key={`h${index}`} style={[styles.hLine, { top: `${(index + 1) * 14}%`, backgroundColor: grid }]} />
      ))}
      {[...Array(5)].map((_, index) => (
        <View key={`v${index}`} style={[styles.vLine, { left: `${(index + 1) * 18}%`, backgroundColor: grid }]} />
      ))}

      <View style={styles.center}>
        <View style={[styles.pinHalo, { backgroundColor: colors.brandSoft, borderColor: colors.brand + "30" }]}>
          <View style={[styles.pinBubble, { backgroundColor: colors.brand, shadowColor: colors.brand }]}>
            <Ionicons name="location" size={compact ? 19 : 26} color={colors.onBrand} />
          </View>
        </View>
        {!compact ? (
          <View style={styles.centerCopy}>
            <AppText variant="eyebrow">LOCATION INTELLIGENCE</AppText>
            <AppText variant="heading" center>
              {pins > 0 ? `${pins} plant${pins > 1 ? "s" : ""} nearby` : label}
            </AppText>
            <AppText variant="caption" center>
              {mapAvailable ? "Location context is ready for the supported map surface." : "Add the configured Maps key to enable the native map surface."}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={[styles.statusChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
        <View style={[styles.statusDot, { backgroundColor: mapAvailable ? colors.brand : colors.warning }]} />
        <Ionicons
          name={mapAvailable ? "map-outline" : "warning-outline"}
          size={13}
          color={mapAvailable ? colors.brand : colors.warning}
        />
        <AppText style={{ fontFamily: fonts.semibold, fontSize: 10, color: colors.onSurfaceSecondary }}>
          {statusLabel}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 180,
    position: "relative",
    overflow: "hidden",
    justifyContent: "center",
    borderRadius: radius.xl,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 2,
  },
  hLine: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  vLine: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  road: { position: "absolute", width: "125%", height: 72, borderWidth: 18, borderRadius: 999, opacity: 0.8 },
  roadOne: { left: "-18%", top: "27%", transform: [{ rotate: "-13deg" }] },
  roadTwo: { right: "-24%", bottom: "4%", transform: [{ rotate: "18deg" }] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  pinHalo: { width: 70, height: 70, borderRadius: 35, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pinBubble: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 7,
  },
  centerCopy: { maxWidth: 320, alignItems: "center", gap: 4, marginTop: spacing.md },
  statusChip: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
});
