import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fontSize, spacing } from "@/src/theme/tokens";

/**
 * Owner plans and promotions use administrative onboarding and individual
 * commercial review, never an in-app Cashfree/digital subscription checkout.
 * Customer purchases of physical ready-mix concrete have a separate flow.
 */
export default function PlansPromotions() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const contactSupport = async () => {
    const address = "mailto:support@trackmyrmc.com?subject=TrackMyRMC%20Plant%20Owner%20Enquiry";
    try {
      await Linking.openURL(address);
    } catch {
      // The email address remains visible for users without an email app.
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      style={{ flex: 1, backgroundColor: colors.surface }}
    >
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.header}
      >
        <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        <AppText variant="title">Plans &amp; Promotions</AppText>
      </Pressable>

      <Card style={{ gap: spacing.md }}>
        <AppText variant="heading">Individual plant onboarding and offers</AppText>
        <AppText variant="bodyMuted">
          TrackMyRMC reviews each RMC plant's registration documents, operational requirements,
          subscription duration and any promotional requirements before proposing commercial terms.
        </AppText>
        <AppText variant="bodyMuted">
          No subscription, promotion, website activation or AI automation payment is collected
          through this app. The TrackMyRMC team will discuss any approved offer directly with you.
        </AppText>
        <Button label="Open Onboarding Form" onPress={() => router.push("/plant-onboarding" as any)} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <AppText variant="heading">Contact TrackMyRMC Support</AppText>
        <AppText variant="bodyMuted">
          For document verification, plan enquiries and personalized service quotations:
        </AppText>
        <AppText style={{ color: colors.brand, fontSize: fontSize.base }}>
          support@trackmyrmc.com
        </AppText>
        <Button label="Email Support" onPress={contactSupport} />
      </Card>

      <View style={{ paddingHorizontal: spacing.xs }}>
        <AppText variant="caption">
          Customer payments for physical ready-mix concrete orders are handled separately
          after the supplying plant confirms the order and the customer accepts its terms.
        </AppText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.md, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
});
