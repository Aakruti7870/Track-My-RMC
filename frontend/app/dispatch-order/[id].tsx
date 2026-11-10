import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useAuth } from "@/src/auth/AuthContext";
import { apiPost } from "@/src/api/client";
import { useToast } from "@/src/components/ui/Toast";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { LoadPlanner } from "@/src/components/LoadPlanner";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type OrderDetail = {
  id: string;
  order_number: string;
  customer_name?: string;
  customer_mobile?: string;
  customer_phone?: string;
  grade: string;
  quantity: number;
  site_name?: string;
  site_address?: string;
  status: string;
};

export default function DispatchOrder() {
  const { colors, scheme } = useTheme();
  const { token } = useAuth();
  const toast = useToast();
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [confirmedConsent, setConfirmedConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, refetch, reload } = useGet<{ order: OrderDetail }>(`/staff/orders/${id}`);
  const o = data?.order;

  const saveDeliveryContact = async () => {
    if (!token || !id) return;
    if (!confirmedConsent) {
      toast("Confirm that the customer agreed to WhatsApp delivery messages", "error");
      return;
    }
    setSavingConsent(true);
    try {
      await apiPost(`/staff/orders/${id}/dispatch-whatsapp-contact`, token, {
        phone: whatsappPhone || o?.customer_mobile || o?.customer_phone || "",
        opted_in: true,
        marketing_opted_in: marketingConsent,
        consent_source: "customer_phone",
      });
      toast("Customer's WhatsApp preferences recorded", "success");
    } catch {
      toast("Unable to record customer consent", "error");
    } finally {
      setSavingConsent(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="disp-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">Dispatch Order</AppText>
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : loading && !data ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={120} style={{ borderRadius: radius.lg }} />
          <Skeleton height={220} style={{ borderRadius: radius.lg }} />
        </View>
      ) : o ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
          <Card style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <AppText variant="heading">{o.order_number}</AppText>
              <Badge label={(o.status || "").replace(/_/g, " ")} status={o.status} />
            </View>
            <AppText style={{ fontFamily: fonts.displayBold, fontSize: fontSize["2xl"], color: colors.onSurface }}>
              {o.grade} · {o.quantity} m³
            </AppText>
            <AppText variant="label">CUSTOMER</AppText>
            {o.customer_name ? <AppText variant="caption">Name: {o.customer_name}</AppText> : null}
            {o.customer_mobile ? <AppText variant="caption">Contact: {o.customer_mobile}</AppText> : null}
            {o.site_name ? <AppText variant="caption">Site: {o.site_name}</AppText> : null}
            {o.site_address ? <AppText variant="caption">{o.site_address}</AppText> : null}
          </Card>

          {o.status === "IN_PRODUCTION" ? (
            <Card><AppText variant="bodyMuted">Production is in progress. You can plan mixer loads now; preparing them remains blocked until production is complete.</AppText></Card>
          ) : null}

          <LoadPlanner orderId={o.id} resourceBase="/staff" onChanged={refetch} />
          <Card style={{ gap: spacing.sm }} testID="staff-dispatch-whatsapp-contact">
            <AppText variant="heading">WhatsApp Dispatch Contact</AppText>
            <AppText variant="caption">
              Record the customer's explicit permission for delivery updates.
              Delivery messages require customer permission. App promotions require a separate
              opt-in; never assume consent from a concrete purchase.
            </AppText>
            <Input label="WhatsApp phone" keyboardType="phone-pad" maxLength={18}
              placeholder={o.customer_mobile || o.customer_phone || "+91…"}
              value={whatsappPhone} onChangeText={setWhatsappPhone} />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmedConsent }}
              onPress={() => setConfirmedConsent(value => !value)}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Ionicons name={confirmedConsent ? "checkbox" : "square-outline"} size={24} color={colors.brand} />
              <AppText style={{ flex: 1 }}>The customer agreed to WhatsApp delivery notifications.</AppText>
            </Pressable>
            <Pressable accessibilityRole="checkbox"
              accessibilityState={{ checked: marketingConsent }}
              onPress={() => setMarketingConsent(value => !value)}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Ionicons name={marketingConsent ? "checkbox" : "square-outline"} size={24} color={colors.brand} />
              <AppText style={{ flex: 1 }}>Customer separately agreed to optional TrackMyRMC WhatsApp app promotions.</AppText>
            </Pressable>
            <Button label="Save WhatsApp Preferences" variant="outline" loading={savingConsent}
              onPress={() => void saveDeliveryContact()} />
          </Card>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
});
