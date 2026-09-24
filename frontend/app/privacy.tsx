import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

const UPDATED = "28 August 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={{ gap: spacing.sm }}>
      <AppText variant="heading">{title}</AppText>
      <AppText variant="bodyMuted">{children}</AppText>
    </Card>
  );
}

export default function PrivacyPolicy() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 96, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="caption" color={colors.brand}>TRACK MY RMC · PRIVACY</AppText>
          <AppText variant="title">Privacy Policy</AppText>
          <AppText variant="bodyMuted">
            How TrackMyRMC collects, uses, protects and deletes information across ordering, plant operations, KYC and delivery tracking.
          </AppText>
          <AppText variant="caption">Last updated: {UPDATED}</AppText>
        </Card>

        <Section title="Who operates this service">
          TrackMyRMC / Concrete King is operated by GOLD-e Tech. Privacy and account-deletion questions can be sent to support@goldetech.com.
        </Section>

        <Section title="Account and operational information">
          We use mobile number or email for authentication and profile, role, plant assignment and KYC status for access control. Operational records may include RMC orders, delivery sites, dispatches, trips, challans, proof of delivery, signatures, invoices, payments, attendance, incidents and support records when those features are used.
        </Section>

        <Section title="Location and live delivery tracking">
          Foreground location may be used for attendance, nearby-plant and delivery operations when you initiate those features. For an assigned Driver delivery only, TrackMyRMC may collect precise background location to enable live mixer delivery tracking even when the app is closed or not in use. During that active trip, location may be shown to the assigned plant and the authorized customer tracking view. Background tracking stops when the delivery is completed. Location is not used for advertising.
        </Section>

        <Section title="Camera, photos and files">
          Camera access is requested only when a Driver chooses to capture a proof-of-delivery site photo. On supported Android versions, existing photos are selected through the system photo picker without broad photo or storage access. KYC consent flows may use approved verification providers such as DigiLocker where enabled.
        </Section>

        <Section title="Notifications">
          If you enable notifications, TrackMyRMC registers a device push token to deliver account-relevant alerts such as order approvals, dispatch and delivery updates, assigned trips, KYC decisions and safety alerts. Notification permission is optional.
        </Section>

        <Section title="Service providers and sharing">
          Data is shared only as needed to provide TrackMyRMC and according to role permissions. Infrastructure, mapping, notification, payment, KYC and authentication providers may process the minimum information required for enabled features. TrackMyRMC does not sell personal data and does not use location for advertising.
        </Section>

        <Section title="Retention and account deletion">
          You can request deletion from inside TrackMyRMC or from the public Delete Account page at trackmyrmc.com/account-deletion. After verified deletion is completed, sign-in identifiers, profile data, sessions, saved customer sites, app notifications and registered push tokens are removed or anonymized. Certain statutory transaction records may be retained only where required for legal, tax, fraud-prevention or accounting obligations.
        </Section>

        <Section title="Security and your choices">
          TrackMyRMC uses authenticated sessions and server-authorized role-based access controls. Sensitive Android permissions are requested only in the feature that needs them. You may decline optional permissions or revoke them in Android settings.
        </Section>

        <Card style={{ gap: spacing.xs }}>
          <AppText variant="heading">Contact</AppText>
          <AppText variant="bodyMuted">Privacy & support: support@goldetech.com</AppText>
          <AppText variant="caption">TrackMyRMC · Concrete King · Powered by GOLD-e Tech</AppText>
        </Card>
      </ScrollView>
    </View>
  );
}
