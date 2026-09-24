import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";
import { AppText } from "./ui/AppText";
import { Button } from "./ui/Button";

export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} testID="error-view" accessibilityRole="alert">
      <View style={[styles.stateCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <View style={[styles.errorIcon, { backgroundColor: colors.error + "12" }]}>
          <Ionicons name="cloud-offline-outline" size={30} color={colors.error} />
        </View>
        <AppText style={[styles.title, { color: colors.onSurface }]} center>We couldn’t load this</AppText>
        <AppText variant="bodyMuted" center>{message}</AppText>
        <Button label="Try Again" onPress={onRetry} fullWidth={false} variant="outline" testID="retry-button" />
      </View>
    </View>
  );
}

export function EmptyView({
  icon = "file-tray-outline",
  title,
  subtitle,
  cta,
  onCta,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  cta?: string;
  onCta?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} testID="empty-view">
      <View style={[styles.stateCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <View style={[styles.iconBubble, { backgroundColor: colors.brandSoft }]}>
          <Ionicons name={icon} size={30} color={colors.brand} />
        </View>
        <AppText style={[styles.title, { color: colors.onSurface }]} center>{title}</AppText>
        {subtitle ? <AppText variant="bodyMuted" center>{subtitle}</AppText> : null}
        {cta && onCta ? (
          <Button label={cta} onPress={onCta} fullWidth={false} testID="empty-cta" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    flexGrow: 1,
  },
  stateCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing["2xl"],
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  iconBubble: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  errorIcon: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: fonts.displayBold, fontSize: 20 },
});