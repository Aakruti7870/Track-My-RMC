import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card style={{ gap: spacing.sm }}><AppText variant="heading">{title}</AppText><AppText variant="bodyMuted">{children}</AppText></Card>;
}

export default function Terms() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 96, gap: spacing.md }} showsVerticalScrollIndicator={false}>
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="caption" color={colors.brand}>TRACK MY RMC · LEGAL</AppText>
          <AppText variant="title">Terms & Conditions</AppText>
          <AppText variant="bodyMuted">Basic rules for using TrackMyRMC and its ready-mix concrete operational services.</AppText>
          <AppText variant="caption">Last updated: 28 August 2026</AppText>
        </Card>
        <Section title="Using TrackMyRMC">TrackMyRMC provides digital tools for ready-mix concrete discovery, ordering, plant operations, dispatch, delivery tracking, challans, KYC, payments and related workflows. Features depend on your account role and plant configuration.</Section>
        <Section title="Accounts and access">Use accurate account information and keep access to your phone, email, Authenticator and authenticated session secure. Role-based permissions must not be bypassed or shared with unauthorized users.</Section>
        <Section title="Orders and commercial terms">Order quantities, grades, delivery schedules, rates, taxes, payment terms and acceptance remain subject to the commercial terms confirmed between the customer and selected plant.</Section>
        <Section title="Location and delivery operations">Driver and delivery features may use location while an assigned trip is active. Tracking, proof-of-delivery and attendance features must be used only for legitimate operational purposes and according to applicable workplace and privacy requirements.</Section>
        <Section title="Payments and third parties">Payment, mapping, KYC, notification and authentication providers may have their own terms. TrackMyRMC does not control third-party service availability.</Section>
        <Section title="Acceptable use">Do not misuse the service, attempt unauthorized access, submit fraudulent records, interfere with tracking or security controls, or use TrackMyRMC for unlawful activity.</Section>
        <Section title="Service availability and changes">Features and security controls may change as the service evolves. Reasonable efforts are made to keep TrackMyRMC available, but uninterrupted operation cannot be guaranteed where networks, devices, maintenance or third-party services are outside our control.</Section>
        <Section title="Contact">Questions about these terms can be sent to support@goldetech.com.</Section>
      </ScrollView>
    </View>
  );
}
