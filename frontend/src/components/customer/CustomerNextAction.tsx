import { StyleSheet, View } from "react-native";

import type { Order } from "@/src/domain/order";
import { spacing } from "@/src/theme/tokens";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

export function CustomerNextAction({ order, onViewOrder }: { order: Order; onViewOrder: () => void }) {
  return (
    <Card testID="customer-next-action" style={styles.card}>
      <View style={styles.headingRow}>
        <AppText variant="heading" style={styles.heading}>Current order</AppText>
        <Badge status={order.status} label={order.status.replace(/_/g, " ")} size="sm" />
      </View>
      <AppText variant="bodyMuted">Order {order.order_number} · {order.grade} · {order.quantity} m³</AppText>
      <Button testID="customer-next-primary" label="View order details" onPress={onViewOrder} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 620, alignSelf: "center", gap: spacing.sm },
  heading: { flexShrink: 1 },
  headingRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
});
