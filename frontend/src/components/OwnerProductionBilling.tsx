import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { apiErrorDetail, apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing, ThemeColors } from "@/src/theme/tokens";

type Production = {
  ordered: number;
  produced: number;
  remaining: number;
  batches: { id?: string; quantity: number; batch_reference?: string; remarks?: string; created_at?: string }[];
};
type ProductionResponse = Partial<Omit<Production, "ordered" | "produced" | "remaining">> & {
  required?: number;
  ordered?: number;
  ordered_quantity?: number;
  produced?: number;
  produced_quantity?: number;
  remaining?: number;
  remaining_quantity?: number;
};

export function OwnerProductionBilling({
  orderId,
  status,
  invoiceNumber,
  onChanged,
}: {
  orderId: string;
  status: string;
  invoiceNumber?: string | null;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [production, setProduction] = useState<Production | null>(null);
  const [showBatch, setShowBatch] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");

  const loadProduction = useCallback(async () => {
    if (!token || !["IN_PRODUCTION", "PRODUCTION_COMPLETE"].includes(status)) return;
    try {
      const p = await apiGet<ProductionResponse>(`/owner/orders/${orderId}/production`, token);
      const ordered = Number(p.required ?? p.ordered ?? p.ordered_quantity ?? 0);
      const produced = Number(p.produced ?? p.produced_quantity ?? 0);
      setProduction({
        ordered,
        produced,
        remaining: Number(p.remaining ?? p.remaining_quantity ?? Math.max(0, ordered - produced)),
        batches: p.batches || [],
      });
    } catch {
      setProduction(null);
    }
  }, [orderId, status, token]);

  useEffect(() => { loadProduction(); }, [loadProduction]);

  const call = async (path: string, body: Record<string, unknown>, message: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await apiPost(path, token, body);
      toast(message, "success");
      await loadProduction();
      onChanged();
    } catch (error: unknown) { toast(apiErrorDetail(error, "Action failed"), "error"); }
    finally { setBusy(false); }
  };

  const addBatch = async () => {
    const qty = Number(quantity);
    if (!qty || qty <= 0) return toast("Enter a valid batch quantity", "error");
    await call(`/owner/orders/${orderId}/production/batch`, {
      quantity: qty,
      batch_reference: reference.trim() || null,
      remarks: remarks.trim() || null,
      consume_materials: true,
    }, "Batch posted and inventory consumed");
    setQuantity(""); setReference(""); setRemarks(""); setShowBatch(false);
  };

  if (["DRAFT", "PENDING", "REJECTED", "CANCELLED"].includes(status)) return null;

  return (
    <View style={{ gap: spacing.md }}>
      {["ACCEPTED", "SCHEDULED", "IN_PRODUCTION", "PRODUCTION_COMPLETE"].includes(status) ? <AppText variant="heading">Production</AppText> : null}

      {["ACCEPTED", "SCHEDULED"].includes(status) ? (
        <Button label="Start Production" variant="outline" loading={busy} onPress={() => call(`/owner/orders/${orderId}/production/start`, {}, "Production started")} icon={<Ionicons name="cog-outline" size={18} color={colors.onSurface} />} />
      ) : null}

      {status === "IN_PRODUCTION" ? (
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Metric label="Ordered" value={`${production?.ordered ?? 0} m³`} colors={colors} />
            <Metric label="Produced" value={`${production?.produced ?? 0} m³`} colors={colors} />
            <Metric label="Remaining" value={`${production?.remaining ?? 0} m³`} colors={colors} />
          </View>
          {production?.batches?.length ? (
            <View style={{ gap: spacing.xs }}>
              {production.batches.map((b, i) => (
                <AppText key={b.id || `${i}`} variant="caption">Batch {i + 1}: {b.quantity} m³{b.batch_reference ? ` · ${b.batch_reference}` : ""}</AppText>
              ))}
            </View>
          ) : <AppText variant="caption">No production batches posted yet.</AppText>}

          {showBatch ? (
            <View style={{ gap: spacing.sm }}>
              <Input label="Batch quantity (m³)" value={quantity} onChangeText={(v) => setQuantity(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" />
              <Input label="Batch reference" value={reference} onChangeText={setReference} placeholder="Optional batch/report reference" />
              <Input label="Remarks" value={remarks} onChangeText={setRemarks} />
              <Button label="Post Batch + Consume Materials" onPress={addBatch} loading={busy} />
              <Button label="Cancel" variant="outline" onPress={() => setShowBatch(false)} />
            </View>
          ) : (
            <Button label="Add Production Batch" variant="secondary" onPress={() => { setQuantity(String(production?.remaining || "")); setShowBatch(true); }} />
          )}
          <Button label="Complete Production" loading={busy} onPress={() => call(`/owner/orders/${orderId}/production/complete`, {}, "Production complete")} />
        </Card>
      ) : null}

      {status === "PRODUCTION_COMPLETE" ? (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <View style={{ flex: 1 }}><AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>Production complete</AppText><AppText variant="caption">Delivery loads can now be prepared.</AppText></View>
        </Card>
      ) : null}

      {status === "DELIVERED" ? (
        <View style={{ gap: spacing.sm }}>
          <AppText variant="heading">Billing</AppText>
          {invoiceNumber ? (
            <Button label={`View Billing (${invoiceNumber})`} onPress={() => router.push("/owner/billing")} icon={<Ionicons name="wallet-outline" size={18} color={colors.onBrand} />} />
          ) : (
            <Button label="Generate Invoice" loading={busy} onPress={() => call(`/owner/orders/${orderId}/invoice`, {}, "Invoice generated")} icon={<Ionicons name="receipt-outline" size={18} color={colors.onBrand} />} />
          )}
        </View>
      ) : null}
    </View>
  );
}

function Metric({ label, value, colors }: { label: string; value: string; colors: ThemeColors }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: 2 }}>
      <AppText variant="caption">{label}</AppText>
      <AppText style={{ fontFamily: fonts.semibold, color: colors.onSurface }}>{value}</AppText>
    </View>
  );
}
