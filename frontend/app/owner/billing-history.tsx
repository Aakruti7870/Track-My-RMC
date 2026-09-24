import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { ErrorView } from "@/src/components/StateViews";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type PaymentStatus = "PAYMENT_PENDING" | "PAID" | "FAILED" | "USER_DROPPED";
type Payment = {
  order_number: string;
  plant_id: string;
  plant_name: string;
  product: "PREMIUM" | "PROMOTION";
  plan: string;
  price: number;
  discount: number;
  payable: number;
  status: PaymentStatus;
  promo_code?: string;
  payment_reference?: string;
  activation_id?: string;
  created_at?: string;
  paid_at?: string;
};
type HistoryResponse = { payments: Payment[]; count: number };
type Filter = "ALL" | PaymentStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PAID", label: "Paid" },
  { key: "PAYMENT_PENDING", label: "Pending" },
  { key: "FAILED", label: "Failed" },
];

const money = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
const pretty = (value?: string) =>
  (value || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
const badgeStatus = (status: PaymentStatus) =>
  status === "PAID" ? "DELIVERED" : status === "FAILED" || status === "USER_DROPPED" ? "CANCELLED" : "PENDING";

export default function OwnerBillingHistory() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (!token) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const query = filter === "ALL" ? "" : `?status=${encodeURIComponent(filter)}`;
      setData(await apiGet<HistoryResponse>(`/plant-plans/payment-history${query}`, token));
    } catch (e: any) {
      setError(e.detail || "Could not load payment history");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, token]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const payments = data?.payments || [];
    return {
      paid: payments.filter((p) => p.status === "PAID").reduce((sum, p) => sum + p.payable, 0),
      pending: payments.filter((p) => p.status === "PAYMENT_PENDING").length,
    };
  }, [data]);

  if (error && !data) return <ErrorView message={error} onRetry={() => load()} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.divider }]}>
        <Pressable testID="billing-history-back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText style={[styles.headerTitle, { color: colors.onSurface }]}>Billing & Payment History</AppText>
          <AppText style={[styles.headerSub, { color: colors.onSurfaceSecondary }]}>Cashfree-verified plan transactions</AppText>
        </View>
        <Ionicons name="receipt-outline" size={26} color={colors.brand} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.brand} />}
      >
        <View style={styles.summaryRow}>
          <Card style={{ flex: 1, gap: 5 }}>
            <AppText variant="caption">Verified paid</AppText>
            <AppText style={[styles.total, { color: colors.success }]}>{money(totals.paid)}</AppText>
          </Card>
          <Card style={{ flex: 1, gap: 5 }}>
            <AppText variant="caption">Pending confirmation</AppText>
            <AppText style={[styles.total, { color: colors.warning }]}>{totals.pending}</AppText>
          </Card>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {FILTERS.map((item) => {
            const selected = filter === item.key;
            return (
              <Pressable
                key={item.key}
                testID={`billing-filter-${item.key.toLowerCase()}`}
                onPress={() => setFilter(item.key)}
                style={[styles.filter, {
                  backgroundColor: selected ? colors.brand : colors.surfaceSecondary,
                  borderColor: selected ? colors.brand : colors.border,
                }]}
              >
                <AppText style={{ fontFamily: fonts.semibold, color: selected ? colors.onBrand : colors.onSurface }}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading && !data ? (
          <><Skeleton height={150} /><Skeleton height={150} /></>
        ) : data?.payments.length ? (
          <View style={{ gap: spacing.md }}>
            {data.payments.map((payment) => (
              <Card key={payment.order_number} style={{ gap: spacing.md }}>
                <View style={styles.line}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <AppText variant="heading">{pretty(payment.product)}</AppText>
                    <AppText variant="caption" numberOfLines={1}>{payment.plant_name}</AppText>
                  </View>
                  <Badge label={pretty(payment.status)} status={badgeStatus(payment.status)} />
                </View>

                <View style={[styles.amountBox, { backgroundColor: colors.surfaceTertiary }]}>
                  <View>
                    <AppText variant="caption">{pretty(payment.plan)}</AppText>
                    <AppText style={[styles.amount, { color: colors.onSurface }]}>{money(payment.payable)}</AppText>
                  </View>
                  {payment.discount > 0 ? (
                    <View style={{ alignItems: "flex-end" }}>
                      <AppText variant="caption">Discount</AppText>
                      <AppText style={{ fontFamily: fonts.semibold, color: colors.success }}>−{money(payment.discount)}</AppText>
                    </View>
                  ) : null}
                </View>

                <View style={{ gap: spacing.sm }}>
                  <Detail label="Order ID" value={payment.order_number} />
                  <Detail label="Created" value={payment.created_at ? new Date(payment.created_at).toLocaleString("en-IN") : "—"} />
                  {payment.paid_at ? <Detail label="Verified" value={new Date(payment.paid_at).toLocaleString("en-IN")} /> : null}
                  {payment.payment_reference ? <Detail label="Transaction reference" value={payment.payment_reference} /> : null}
                  {payment.promo_code ? <Detail label="Promo code" value={payment.promo_code} /> : null}
                </View>

                <View style={[styles.notice, { borderColor: colors.border }]}>
                  <Ionicons
                    name={payment.status === "PAID" ? "shield-checkmark-outline" : payment.status === "PAYMENT_PENDING" ? "time-outline" : "alert-circle-outline"}
                    size={18}
                    color={payment.status === "PAID" ? colors.success : payment.status === "PAYMENT_PENDING" ? colors.warning : colors.error}
                  />
                  <AppText variant="caption" style={{ flex: 1 }}>
                    {payment.status === "PAID"
                      ? "Verified by Cashfree webhook. Plan access is active."
                      : payment.status === "PAYMENT_PENDING"
                        ? "Awaiting signed Cashfree confirmation. Access remains locked."
                        : "No plan access was activated for this transaction."}
                  </AppText>
                </View>
              </Card>
            ))}
          </View>
        ) : (
          <Card style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"] }}>
            <Ionicons name="receipt-outline" size={34} color={colors.onSurfaceTertiary} />
            <AppText variant="heading">No payments found</AppText>
            <AppText variant="caption" center>New Premium and Promotion payments will appear here.</AppText>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.line}>
      <AppText variant="caption">{label}</AppText>
      <AppText style={{ maxWidth: "62%", textAlign: "right", fontFamily: fonts.medium, fontSize: fontSize.sm, color: colors.onSurface }} selectable>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  headerSub: { fontFamily: fonts.regular, fontSize: 12 },
  summaryRow: { flexDirection: "row", gap: spacing.sm },
  total: { fontFamily: fonts.displayBold, fontSize: fontSize.xl },
  filter: { minHeight: 40, minWidth: 76, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  amountBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md },
  amount: { fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], marginTop: 3 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md },
});
