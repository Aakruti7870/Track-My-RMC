import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useAuth } from "@/src/auth/AuthContext";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { OrderCard, OrderData } from "@/src/components/OrderCard";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { fonts, palette, radius, spacing } from "@/src/theme/tokens";

const FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "pending", label: "Pending", match: (s) => ["PENDING", "DRAFT"].includes(s) },
  { key: "accepted", label: "Accepted", match: (s) => ["ACCEPTED", "SCHEDULED"].includes(s) },
  { key: "production", label: "In Production", match: (s) => ["IN_PRODUCTION", "PRODUCTION_COMPLETE"].includes(s) },
  { key: "dispatched", label: "Dispatched", match: (s) => ["DISPATCHED", "EN_ROUTE", "AT_SITE", "UNLOADING", "POD_PENDING", "TM_ASSIGNED", "DRIVER_ASSIGNED", "READY_TO_DISPATCH"].includes(s) },
  { key: "delivered", label: "Delivered", match: (s) => s === "DELIVERED" },
  { key: "cancelled", label: "Cancelled", match: (s) => ["CANCELLED", "REJECTED"].includes(s) },
];

type PlantOrderRequest = {
  id: string;
  plant_name: string | null;
  google_place_id?: string | null;
  status: "PENDING_ADMIN_REVIEW" | "AWAITING_PLANT" | "READY_FOR_QUOTATION" | "DECLINED";
  decision_note?: string;
  quotation_plant_id?: string;
  quotation_requested?: boolean;
  grade: string;
  quantity_m3: number;
  delivery_date: string;
  site_address: string;
};

export default function CustomerOrders() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [active, setActive] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const { data, loading, error, refetch, reload } = useGet<{ orders: OrderData[] }>("/customer/orders");
  const drafts = useGet<{ drafts: { id: string; form: { site_name: string; grade: string | null; quantity: string }; provisional_status?: string | null; provisional_order_id?: string | null; plant_response?: string | null }[] }>("/customer/order-drafts");
  const review = useGet<{ requests: PlantOrderRequest[] }>("/customer/plant-order-requests");
  useFocusEffect(useCallback(() => {
    void refetch(); void drafts.refetch(); void review.refetch();
  }, [refetch, drafts.refetch, review.refetch]));

  const filter = FILTERS.find((f) => f.key === active)!;
  const filtered = (data?.orders || []).filter((order) => filter.match(order.status.toUpperCase()));
  const showDrafts = active === "all" || active === "pending";
  const visibleDrafts = showDrafts ? drafts.data?.drafts || [] : [];
  const draftsLoading = showDrafts && drafts.loading && !drafts.data;
  const draftsError = showDrafts && drafts.error;
  const showReview = showDrafts || active === "cancelled";
  const reviewRequests = showReview ? (review.data?.requests ?? []).filter(request =>
    active === "all" || (active === "cancelled" ? request.status === "DECLINED" : request.status !== "DECLINED")) : [];
  const reviewError = showReview && review.error;
  const reviewLoading = showReview && review.loading && !review.data;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), drafts.refetch(), review.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ThemedScreen>
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      {/* Sticky header + chip row */}
      <View style={{ borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }}>
        <View style={styles.titleRow}>
          <AppText variant="title">My Orders</AppText>
        </View>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(i) => i.key}
          style={styles.chipRow}
          contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" }}
          renderItem={({ item }) => {
            const selected = item.key === active;
            return (
              <Pressable
                testID={`filter-${item.key}`}
                accessibilityRole="button"
                accessibilityLabel={`Show ${item.label} orders`}
                accessibilityState={{ selected }}
                onPress={() => setActive(item.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.brand : colors.surfaceSecondary,
                    borderColor: selected ? colors.brand : colors.border,
                  },
                ]}
              >
                <AppText
                  maxFontSizeMultiplier={0}
                  style={{
                    fontFamily: fonts.semibold,
                    fontSize: 13,
                    color: selected ? palette.graphite : colors.onSurfaceSecondary,
                  }}
                >
                  {item.label}
                </AppText>
              </Pressable>
            );
          }}
        />
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : loading && !data ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={150} style={{ borderRadius: radius.lg }} />
          ))}
        </View>
      ) : (
        <FlatList
          testID="orders-list"
          data={filtered}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          ListHeaderComponent={<View style={{ gap: spacing.md }}>
          {reviewRequests.length || reviewError || reviewLoading ? <View style={{ gap: spacing.sm }}>
            <AppText variant="heading">Plant Order Requests</AppText>
            {reviewLoading ? <ActivityIndicator color={colors.brand} accessibilityLabel="Loading order requests" /> : null}
            {reviewError ? <Button label="Retry loading order requests" size="sm" variant="outline" fullWidth={false} onPress={() => void review.reload()} /> : null}
            {reviewRequests.map(request => <Card key={request.id} style={{ gap: spacing.xs }}>
              <AppText variant="label">{request.plant_name || (request.google_place_id ? "Google-listed plant" : "Plant order request")}</AppText>
              {request.google_place_id ? <Button label="View on Google Maps" size="sm" variant="outline" fullWidth={false}
                onPress={() => {
                  const placeId = encodeURIComponent(request.google_place_id ?? "");
                  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=RMC%20plant&query_place_id=${placeId}`)
                    .catch(() => undefined);
                }} /> : null}
              <AppText>{request.site_address}</AppText>
              <AppText variant="caption">{request.grade} · {request.quantity_m3} m³ · {request.delivery_date}</AppText>
              <AppText variant="caption">{({
                PENDING_ADMIN_REVIEW: "Awaiting Super Admin review",
                AWAITING_PLANT: "Awaiting plant onboarding",
                READY_FOR_QUOTATION: request.quotation_requested ? "Quotation requested" : "Ready to request a quotation",
                DECLINED: "Declined",
              })[request.status] ?? "Awaiting Super Admin review"}</AppText>
              {request.decision_note ? <AppText>{request.decision_note}</AppText> : null}
              {request.quotation_requested ? <Button label="View Quotations" size="sm" onPress={() => router.push("/customer/quotations")} /> : null}
              {request.quotation_plant_id && !request.quotation_requested ? <Button label="Review and Request Quotation" size="sm"
                onPress={() => router.push({ pathname: "/customer/request-quotation", params: { reviewId: request.id } })} /> : null}
              <AppText variant="caption">Reference {request.id}</AppText>
            </Card>)}
          </View> : null}
          {visibleDrafts.length || draftsLoading || draftsError ? <View style={{ gap: spacing.sm }}>
            <AppText variant="heading">Saved Drafts</AppText>
            {draftsLoading ? (
              <View style={styles.draftLoading} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colors.brand} />
                <AppText variant="caption">Loading saved drafts…</AppText>
              </View>
            ) : null}
            {draftsError ? (
              <View style={{ gap: spacing.sm }} accessibilityLiveRegion="polite">
                <AppText variant="bodyMuted">Could not load saved drafts.</AppText>
                <Button label="Retry drafts" size="sm" variant="outline" fullWidth={false} onPress={() => void drafts.reload()} />
              </View>
            ) : null}
            {visibleDrafts.map((draft) => <Pressable key={draft.id} accessibilityRole="button"
              onPress={() => draft.provisional_status === "CONVERTED" && draft.provisional_order_id
                ? router.push({ pathname: "/order/[id]", params: { id: draft.provisional_order_id } })
                : router.push({ pathname: "/new-order", params: { draftId: draft.id } })}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, padding: spacing.md, gap: spacing.xs }}>
              <AppText variant="heading">{draft.form.site_name || "Untitled order draft"}</AppText>
              <AppText variant="caption">{draft.provisional_status === "PENDING_KYC" ? (user?.kyc_status?.toUpperCase() === "VERIFIED" ? "AWAITING CUSTOMER CONFIRMATION" : "PROVISIONAL · PENDING KYC") : draft.provisional_status === "CONVERTED" ? "ORDER SUBMITTED" : draft.provisional_status || "DRAFT"} · {draft.form.grade || "Grade not selected"} · {draft.form.quantity || "Quantity not set"} m³</AppText>
              {draft.plant_response ? <AppText variant="caption">Plant response: {draft.plant_response}</AppText> : null}
              <AppText variant="caption" color={colors.brand}>Review details</AppText>
            </Pressable>)}
          </View> : null}
          </View>}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            visibleDrafts.length || draftsLoading || draftsError || reviewRequests.length || reviewError || reviewLoading ? null : (
              <View testID="orders-empty-next-action" style={{ gap: spacing.lg, alignItems: "stretch" }}>
                <EmptyView
                  icon="cube-outline"
                  title={active === "all" ? "Ready for your first pour?" : "No orders in this status"}
                  subtitle={active === "all" ? "You can build and save an order request before completing KYC." : "Try a different status to find your orders."}
                />
                <Button
                  label={active === "all" ? "Start an Order Request" : "View All Orders"}
                  onPress={() => active === "all" ? router.push("/new-order") : setActive("all")}
                />
              </View>
            )
          }
        />
      )}
    </View>
    </ThemedScreen>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  chipRow: { flexGrow: 0, marginBottom: spacing.sm },
  draftLoading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chip: {
    minHeight: 48,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
