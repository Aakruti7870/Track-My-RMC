import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Invoice = { id: string; invoice_number: string; order_number: string; customer_name: string; grade: string; quantity: number; total: number; paid: number; balance: number; status: string };
type Data = { invoices: Invoice[]; summary: { billed: number; received: number; outstanding: number } };

const money = (n: number) => "₹" + (n || 0).toLocaleString("en-IN");

export default function Billing() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { data, error, reload } = useGet<Data>("/owner/invoices");
  const [payFor, setPayFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const pay = async (id: string) => {
    if (!amount || Number(amount) <= 0) return toast("Enter an amount", "error");
    setBusy(true);
    try {
      await apiPost(`/owner/invoices/${id}/payment`, token!, { amount: Number(amount) });
      toast("Payment recorded", "success");
      setPayFor(null); setAmount("");
      reload();
    } catch (e: any) {
      toast(e.detail || "Failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="billing-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">Billing & Ledger</AppText>
      </View>
      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {[["Billed", data?.summary.billed, colors.onSurface], ["Received", data?.summary.received, colors.success], ["Outstanding", data?.summary.outstanding, colors.warning]].map(([l, v, c]: any) => (
              <View key={l} style={[styles.kpi, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize.lg, color: c }}>{money(v || 0)}</AppText>
                <AppText variant="caption">{l}</AppText>
              </View>
            ))}
          </View>

          <AppText variant="heading">Invoices</AppText>
          {(data?.invoices || []).length === 0 ? (
            <EmptyView icon="receipt-outline" title="No invoices yet" subtitle="Deliver an order, then raise its invoice" />
          ) : (
            (data?.invoices || []).map((inv) => (
              <Card key={inv.id} style={{ gap: spacing.sm }}>
                <View style={styles.rowBetween}>
                  <View>
                    <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.base, color: colors.onSurface }}>{inv.invoice_number}</AppText>
                    <AppText variant="caption">{inv.order_number} · {inv.customer_name}</AppText>
                  </View>
                  <Badge label={inv.status} status={inv.status} />
                </View>
                <View style={styles.rowBetween}>
                  <AppText variant="caption">{inv.grade} · {inv.quantity} m³</AppText>
                  <AppText style={{ fontFamily: fonts.bold, color: colors.onSurface }}>{money(inv.total)}</AppText>
                </View>
                <View style={[styles.rowBetween, { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm }]}>
                  <AppText variant="caption" color={colors.success}>Paid {money(inv.paid)}</AppText>
                  <AppText variant="caption" color={inv.balance > 0 ? colors.warning : colors.success}>Balance {money(inv.balance)}</AppText>
                </View>
                {inv.balance > 0 ? (
                  payFor === inv.id ? (
                    <View style={{ gap: spacing.sm }}>
                      <Input testID={`pay-amount-${inv.id}`} value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder={`Amount (max ${inv.balance})`} />
                      <View style={{ flexDirection: "row", gap: spacing.sm }}>
                        <View style={{ flex: 1 }}><Button testID={`pay-cancel-${inv.id}`} label="Cancel" variant="secondary" onPress={() => { setPayFor(null); setAmount(""); }} /></View>
                        <View style={{ flex: 1 }}><Button testID={`pay-confirm-${inv.id}`} label="Record" loading={busy} onPress={() => pay(inv.id)} /></View>
                      </View>
                    </View>
                  ) : (
                    <Button testID={`record-payment-${inv.id}`} label="Record Payment" variant="outline" onPress={() => { setPayFor(inv.id); setAmount(String(inv.balance)); }} />
                  )
                ) : null}
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  kpi: { flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
