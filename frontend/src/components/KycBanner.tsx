import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VectorSymbol, type VectorSymbolName } from "./VectorSymbol";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts } from "@/src/theme/tokens";
import { AppText } from "./ui/AppText";

const CONFIG: Record<
  string,
  { symbol: VectorSymbolName; title: string; sub: string; tone: "verified" | "brand" | "warning" | "error" }
> = {
  VERIFIED: { symbol: "kyc-verified", title: "KYC VERIFIED", sub: "You can place orders using the app", tone: "verified" },
  PENDING: { symbol: "pending-approval", title: "KYC Under Review", sub: "We’re verifying your details", tone: "warning" },
  REJECTED: { symbol: "warning", title: "KYC Rejected", sub: "Review the issue and retry verification", tone: "error" },
  REQUIRES_REVERIFICATION: { symbol: "warning", title: "Re-verification Needed", sub: "Update your KYC to continue", tone: "warning" },
  NOT_STARTED: { symbol: "kyc-verification", title: "Complete your KYC", sub: "Verify once to unlock ordering", tone: "brand" },
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
          backgroundColor: colors.surfaceSecondary,
          borderColor: isVerified ? tone + "60" : tone + "34",
          transform: [{ scale: pressed && !isVerified ? 0.992 : 1 }],
          shadowColor: isVerified ? tone : colors.shadow,
          shadowOpacity: isVerified ? (colors.isDark ? 0.18 : 0.08) : 0,
        },
      ]}
    >
      <VectorSymbol name={cfg.symbol} size={28} />
      <View style={styles.copy}>
        <AppText style={{ fontFamily: "Raleway-Bold", fontSize: 15, lineHeight: 22, color: isVerified ? tone : colors.onSurface }}>
          {cfg.title}
        </AppText>
        <AppText variant="caption" style={{ fontSize: 10, lineHeight: 18 }}>{cfg.sub}</AppText>
      </View>
      <View style={[styles.trailing, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Ionicons name={isVerified ? "checkmark" : "chevron-forward"} size={17} color={isVerified ? tone : colors.onSurfaceTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 0,
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
