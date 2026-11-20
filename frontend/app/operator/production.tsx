import React, { useCallback, useRef, useState } from "react";
import { Modal, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { ErrorView } from "@/src/components/StateViews";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Item = { id: string; primary: string; secondary?: string; meta?: string; badge?: string; badge_status?: string };
type Collection = { title: string; empty: string; items: Item[] };
type Progress = {
  order_id: string;
  order_number: string;
  grade: string;
  status: string;
  ordered_quantity: number;
  produced_quantity: number;
  remaining_quantity: number;
  batches: { id: string; quantity: number; batch_reference?: string; remarks?: string; created_at?: string }[];
};

export default function OperatorProduction() {
  const { token } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { data, loading, error, reload, refetch } = useGet<Collection>("/staff/collection/production");
  const grants = useGet<{ permissions: { key: string; view: boolean; edit: boolean }[] }>("/staff/module-permissions");
  const { refetch: refreshGrants } = grants;
  const canEdit = !grants.error && grants.data?.permissions.some(grant => grant.key === "production_queue" && grant.view && grant.edit) === true;
  useFocusEffect(useCallback(() => { void refetch(); void refreshGrants(); }, [refetch, refreshGrants]));
  const [selected, setSelected] = useState<Item | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const batchRequestId = useRef<string | null>(null);

  const start = async (item: Item) => {
    if (!token || !canEdit) return;
    setBusy(true);
    try {
      await apiPost(`/staff/orders/${item.id}/production/start`, token);
      toast("Production started", "success");
      refetch();
    } catch (failure) { toast(apiErrorDetail(failure, "Could not start production"), "error"); }
    finally { setBusy(false); }
  };

  const openBatch = async (item: Item) => {
    if (!token || !canEdit) return;
    setBusy(true);
    try {
      const p = await apiGet<Progress>(`/staff/orders/${item.id}/production`, token);
      batchRequestId.current = null;
      setSelected(item); setProgress(p); setQuantity(String(p.remaining_quantity || "")); setReference(""); setRemarks("");
    } catch (failure) { toast(apiErrorDetail(failure, "Could not load production"), "error"); }
    finally { setBusy(false); }
  };

  const addBatch = async () => {
    if (!token || !selected || !canEdit || busy) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return toast("Enter a valid batch quantity", "error");
    setBusy(true);
    try {
      await apiPost(`/staff/orders/${selected.id}/production/batch`, token, {
        quantity: qty,
        request_id: batchRequestId.current ||= `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        batch_reference: reference.trim() || null,
        remarks: remarks.trim() || null,
        consume_materials: true,
      });
      const p = await apiGet<Progress>(`/staff/orders/${selected.id}/production`, token);
      setProgress(p); setQuantity(String(p.remaining_quantity || "")); setReference(""); setRemarks("");
      batchRequestId.current = null;
      toast("Batch posted and inventory consumed", "success");
      refetch();
    } catch (failure) { toast(apiErrorDetail(failure, "Could not post batch"), "error"); }
    finally { setBusy(false); }
  };

  const complete = async (item: Item) => {
    if (!token || !canEdit) return;
    setBusy(true);
    try {
      await apiPost(`/staff/orders/${item.id}/production/complete`, token);
      toast("Production completed", "success");
      setSelected(null); setProgress(null); refetch();
    } catch (failure) { toast(apiErrorDetail(failure, "Production cannot be completed"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}>
        <View testID="operator-production-heading"><AppText variant="title">Production</AppText><AppText variant="caption">Batch concrete and consume mix-design materials from inventory</AppText></View>
        {error ? <ErrorView message={error} onRetry={reload} /> : null}
        {grants.error ? <ErrorView message={grants.error} onRetry={grants.reload} /> : null}
        {loading && !data ? <><Skeleton height={100} /><Skeleton height={100} /></> : null}
        {data?.items.map((item) => {
          const status = (item.badge_status || item.badge || "").trim().toLowerCase();
          return (
            <Card key={item.id} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{item.primary}</AppText>
                  {item.secondary ? <AppText variant="caption">{item.secondary}</AppText> : null}
                  {item.meta ? <AppText variant="caption">{item.meta}</AppText> : null}
                </View>
                <Badge label={(item.badge || status).replace(/_/g, " ")} status={item.badge_status || status} orderStatus />
              </View>
              {canEdit && ["confirmed", "scheduled"].includes(status) ? <Button label="Start Production" onPress={() => start(item)} loading={busy} /> : null}
              {canEdit && status === "in_production" ? (
                <View style={{ gap: spacing.sm }}>
                  <Button label="Post Production Batch" onPress={() => openBatch(item)} />
                  <Button label="Complete Production" variant="outline" onPress={() => complete(item)} loading={busy} />
                </View>
              ) : null}
            </Card>
          );
        })}
        {data && data.items.length === 0 ? <Card><AppText variant="bodyMuted">{data.empty}</AppText></Card> : null}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ maxHeight: "88%", backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg }}>
            <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
              <AppText variant="heading">{progress?.order_number} · {progress?.grade}</AppText>
              <Card style={{ gap: 4 }}>
                <AppText variant="caption">Ordered {progress?.ordered_quantity || 0} m³</AppText>
                <AppText variant="caption">Produced {progress?.produced_quantity || 0} m³</AppText>
                <AppText variant="caption">Remaining {progress?.remaining_quantity || 0} m³</AppText>
              </Card>
              {progress?.batches?.map((b, index) => (
                <Card key={b.id} style={{ gap: 3 }}>
                  <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>Batch {index + 1} · {b.quantity} m³</AppText>
                  {b.batch_reference ? <AppText variant="caption">Reference {b.batch_reference}</AppText> : null}
                  {b.remarks ? <AppText variant="caption">{b.remarks}</AppText> : null}
                </Card>
              ))}
              <Input label="Batch quantity (m³)" value={quantity} onChangeText={(v) => { batchRequestId.current = null; setQuantity(v.replace(/[^0-9.]/g, "")); }} keyboardType="numeric" />
              <Input label="Batch reference (optional)" value={reference} onChangeText={(v) => { batchRequestId.current = null; setReference(v); }} placeholder="Batch plant / report reference" />
              <Input label="Remarks (optional)" value={remarks} onChangeText={(v) => { batchRequestId.current = null; setRemarks(v); }} />
              <Button label="Post Batch + Consume Materials" onPress={addBatch} loading={busy} />
              {progress && progress.ordered_quantity > 0 && progress.produced_quantity + 0.001 >= progress.ordered_quantity * 0.98 ? <Button testID="operator-complete-modal" label="Complete Production" variant="outline" onPress={() => selected && complete(selected)} /> : null}
              <Button label="Close" variant="outline" onPress={() => setSelected(null)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
