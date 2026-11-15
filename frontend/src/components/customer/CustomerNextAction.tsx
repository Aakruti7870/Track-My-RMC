import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import type { Order } from "@/src/domain/order";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing, radius, fonts } from "@/src/theme/tokens";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

type Props = {
  activeOrder: Order | null;
  hasOrderHistory: boolean;
  kycVerified: boolean;
  onCreateOrder: () => void;
  onViewOrder: (id: string) => void;
  onViewOrders: () => void;
  onVerifyIdentity: () => void;
};

export function CustomerNextAction({
  activeOrder, hasOrderHistory, kycVerified,
  onCreateOrder, onViewOrder, onViewOrders, onVerifyIdentity,
}: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const active = Boolean(activeOrder);
  const title = active
    ? "Current order"
    : !kycVerified
      ? "Prepare an order request"
      : hasOrderHistory
        ? "Request your next pour"
        : "Start your first concrete order";
  const description = activeOrder
    ? `Order ${activeOrder.order_number} · ${activeOrder.grade} · ${activeOrder.quantity} m³. See the latest delivery details.`
    : !kycVerified
      ? "Build and save a request without completing KYC first. Verification is needed before a live order is confirmed."
      : hasOrderHistory
        ? "Create another request or revisit your previous orders. Plant acceptance and final commercial terms still apply."
        : "Choose a plant, grade, quantity and delivery site. You can review everything before sending the request.";
  const primaryLabel = active ? "View order details" : "Start an order request";
  const primaryAction = activeOrder
    ? () => onViewOrder(activeOrder.id)
    : onCreateOrder;
  const secondaryLabel = active ? "All orders" : kycVerified ? "My orders" : "Verify identity";
  const secondaryAction = active || kycVerified ? onViewOrders : onVerifyIdentity;

  return (
    <Card variant="muted" testID="customer-next-action" style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.headingRow}>
        <AppText variant="heading" style={styles.heading}>{title}</AppText>
        {activeOrder ? <Badge status={activeOrder.status} label={activeOrder.status.replace(/_/g, " ")} size="sm" /> : null}
      </View>
      <AppText variant="bodyMuted">{description}</AppText>
      <View style={[styles.actions, width < 375 && styles.actionsStacked]}>
        <View style={styles.actionCell}>
          <Button testID="customer-next-primary" label={primaryLabel} onPress={primaryAction} />
        </View>
        <View style={styles.actionCell}>
          <Button testID="customer-next-secondary" label={secondaryLabel} variant="outline" onPress={secondaryAction} />
        </View>
      </View>
      {!active && kycVerified ? (
        <AppText variant="caption" style={styles.footnote}>
          No payment is taken when you submit an order request.
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 620, alignSelf: "center", gap: spacing.sm, borderRadius: radius.lg },
  heading: { flexShrink: 1 },
  headingRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  actions: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm, marginTop: spacing.xs },
  actionsStacked: { flexDirection: "column" },
  actionCell: { flex: 1, minWidth: 0 },
  footnote: { fontFamily: fonts.medium },
});
