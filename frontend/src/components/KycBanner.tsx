import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { control, fonts, fontSize, radius, spacing } from "@/src/theme/tokens";
import { AppText } from "./ui/AppText";

const CONFIG: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; tone: "verified" | "brand" | "warning" | "error" }
> = {
  VERIFIED: { icon: "checkmark-circle", title: "KYC VERIFIED", sub: "You can place orders using the app", tone: "verified" },
  PENDING: { icon: "hourglass-outline", title: "KYC Under Review", sub: "We’re verifying your details", tone: "warning" },
  REJECTED: { icon: "close-circle-outline", title: "KYC Rejected", sub: "Review the issue and retry verification", tone: "error" },
  REQUIRES_REVERIFICATION: { icon: "refresh-outline", title: "Re-verification Needed", sub: "Update your KYC to continue", tone: "warning" },
  NOT_STARTED: { icon: "id-card-outline", title: "Complete your KYC", sub: "Verify once to unlock ordering", tone: "brand" },
};

export function KycBanner({ status }: { status: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const cfg = CONFIG[status] || CONFIG.NOT_STARTED;
  const tone = {
    verified: colors.verified,
    brand: colors.brand,
    warning: colors.warning,
    error: colors.error,
  }[cfg.tone];
  const soft = {
    verified: colors.verifiedSoft,
    brand: colors.brandSoft,
    warning: colors.warning + "14",
    error: colors.errorSoft,
  }[cfg.tone];
  const isVerified = status === "VERIFIED";

  return (
    <Pressable
      testID="kyc-banner"
      disabled={isVerified}
      accessibilityRole={isVerified ? "text" : "button"}
      accessibilityLabel={`${cfg.title}. ${cfg.sub}`}
      accessibilityHint={isVerified ? undefined : "Opens KYC verification"}
      onPress={() => router.push("/kyc")}
      style={({ pressed }) => [
        styles.wrap,
        {
          backgroundColor: soft,
          borderColor: isVerified ? tone + "60" : tone + "34",
          transform: [{ scale: pressed && !isVerified ? 0.992 : 1 }],
          shadowColor: isVerified ? tone : colors.shadow,
          shadowOpacity: isVerified ? (colors.isDark ? 0.18 : 0.08) : 0,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: isVerified ? tone : colors.surfaceSecondary, borderColor: tone + "32" }]}>
        <Ionicons name={cfg.icon} size={20} color={isVerified ? "#FFFFFF" : tone} />
      </View>
      <View style={styles.copy}>
        <AppText variant="eyebrow" color={tone}>{isVerified ? "IDENTITY STATUS" : "VERIFICATION"}</AppText>
        <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.base, lineHeight: 20, color: isVerified ? tone : colors.onSurface }}>
          {cfg.title}
        </AppText>
        <AppText variant="caption">{cfg.sub}</AppText>
      </View>
      <View style={[styles.trailing, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Ionicons name={isVerified ? "checkmark" : "chevron-forward"} size={17} color={isVerified ? tone : colors.onSurfaceTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 0,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { minWidth: 0, flex: 1, gap: 1 },
  trailing: {
    width: control.iconButton - 6,
    height: control.iconButton - 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
