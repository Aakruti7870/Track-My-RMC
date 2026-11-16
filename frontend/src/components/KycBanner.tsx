import React from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol } from "./VectorSymbol";
import { IdentityVerificationSymbol } from "./vector-symbols/IdentityVerificationSymbol";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { customerHomeSizes, fonts, homeArtwork } from "@/src/theme/tokens";
import { AppText } from "./ui/AppText";

const CONFIG: Record<
  string,
  { title: string; sub: string; tone: "verified" | "warning" | "error" }
> = {
  VERIFIED: { title: "KYC Verified", sub: "You can place orders using the app", tone: "verified" },
  IN_PROGRESS: { title: "KYC in progress", sub: "Continue your DigiLocker verification", tone: "warning" },
  PENDING: { title: "KYC Under Review", sub: "We’re verifying your details", tone: "warning" },
  REJECTED: { title: "KYC Rejected", sub: "Review the issue and retry verification", tone: "error" },
  REQUIRES_REVERIFICATION: { title: "Re-verification Needed", sub: "Update your KYC to continue", tone: "warning" },
  NOT_STARTED: { title: "Complete your KYC", sub: "Verify once to unlock ordering", tone: "error" },
};

export function KycBanner({ status }: { status: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const size = customerHomeSizes(width, Platform.OS);
  const key = status.trim().toUpperCase();
  const cfg = CONFIG[key] || CONFIG.NOT_STARTED;
  const tone = {
    verified: colors.verified,
    warning: colors.warning,
    error: colors.error,
  }[cfg.tone];
  const isVerified = key === "VERIFIED";
  const needsKyc = cfg === CONFIG.NOT_STARTED;

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
        { gap: size.kycGap, paddingHorizontal: size.kycPadding, paddingVertical: size.kycPadding, borderRadius: size.kycRadius },
        {
          backgroundColor: isVerified ? colors.verifiedSoft : homeArtwork.kycSurface,
          borderColor: isVerified ? colors.verified + "66" : "#6334FA50",
          transform: [{ scale: pressed && !isVerified ? 0.992 : 1 }],
        },
      ]}
    >
      {isVerified ? <VectorSymbol name="kyc-verified" size={size.kycSymbol} color={tone} />
        : <IdentityVerificationSymbol size={size.kycSymbol + 6} />}
      <View style={styles.copy}>
        <AppText style={{ fontFamily: fonts.bold, fontSize: size.kycTitle, lineHeight: size.kycTitleLine, color: tone }}>
          {cfg.title}
        </AppText>
        <AppText variant="caption" style={{ fontSize: size.kycSubtitle, lineHeight: size.kycSubtitleLine, color: needsKyc && !colors.isDark ? "#166534" : needsKyc || isVerified ? colors.verified : colors.onSurfaceSecondary }}>{cfg.sub}</AppText>
      </View>
      <View style={[styles.trailing, { width: size.kycArrow, height: size.kycArrow, borderRadius: size.kycArrow / 2, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Ionicons name={isVerified ? "checkmark" : "chevron-forward"} size={size.kycArrowIcon} color={isVerified ? tone : colors.onSurfaceTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
  },
  copy: { minWidth: 0, flex: 1, gap: 1 },
  trailing: {
    width: 25,
    height: 25,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
