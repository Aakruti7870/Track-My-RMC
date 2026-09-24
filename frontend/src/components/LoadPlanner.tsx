import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { apiErrorDetail, apiGet, apiPost, apiPut } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Load = {
  id: string;
  load_number: number;
  load_code: string;
  quantity_m3: number;
  status: string;
  vehicle_id?: string | null;
  tm_number?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  challan_number?: string | null;
  gate_pass_number?: string | null;
  delivered_quantity?: number | null;
};
type LoadResponse = {
  order_id: string;
  ordered_quantity_m3: number;
  planned_quantity_m3: number;
  delivered_quantity_m3: number;
  remaining_quantity_m3: number;
  loads: Load[];
};
type Vehicle = { id: string; tm_number: string; capacity_m3: number; status: string };
type Driver = { id: string; name: string; phone?: string | null };

type Props = {
  orderId: string;
  resourceBase: "/staff" | "/owner";
  onChanged?: () => void;
};

export function LoadPlanner({ orderId, resourceBase, onChanged }: Props) {
  const { token } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [data, setData] = useState<LoadResponse | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [assigning, setAssigning] = useState<Load | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [loads, fleet, driverList] = await Promise.all([
        apiGet<LoadResponse>(`/loads/orders/${orderId}`, token),
        apiGet<{ vehicles: Vehicle[] }>(`${resourceBase}/fleet`, token),
        apiGet<{ drivers: Driver[] }>(`${resourceBase}/drivers`, token),
      ]);
      setData(loads);
      setVehicles(fleet.vehicles || []);
      setDrivers(driverList.drivers || []);
    } catch (error: unknown) {
      toast(apiErrorDetail(error, "Could not load delivery loads"), "error");
    } finally {
      setLoading(false);
    }
  }, [orderId, resourceBase, token, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const changed = async () => {
    await refresh();
    onChanged?.();
  };

  const createLoad = async () => {
    if (!token) return;
    const amount = Number(qty);
    if (!amount || amount <= 0) return toast("Enter a valid load quantity", "error");
    setBusy(true);
    try {
      await apiPost(`/loads/orders/${orderId}`, token, { quantity_m3: amount });
      setAddOpen(false); setQty("");
      toast("Load planned", "success");
      await changed();
    } catch (error: unknown) { toast(apiErrorDetail(error, "Could not plan load"), "error"); }
    finally { setBusy(false); }
  };

  const openAssign = (load: Load) => {
    setAssigning(load);
    setVehicleId(load.vehicle_id || "");
    setDriverId(load.driver_id || "");
  };

  const saveAssignment = async () => {
    if (!token || !assigning) return;
    if (!vehicleId || !driverId) return toast("Select both a transit mixer and driver", "error");
    setBusy(true);
    try {
      await apiPut(`/loads/${assigning.id}/assignment`, token, { vehicle_id: vehicleId, driver_id: driverId });
      setAssigning(null);
      toast("Load assigned", "success");
      await changed();
    } catch (error: unknown) { toast(apiErrorDetail(error, "Assignment failed"), "error"); }
    finally { setBusy(false); }
  };

  const action = async (path: string, success: string, body?: Record<string, unknown>) => {
    if (!token) return;
    setBusy(true);
    try {
      await apiPost(path, token, body);
      toast(success, "success");
      await changed();
    } catch (error: unknown) { toast(apiErrorDetail(error, "Action failed"), "error"); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <><Skeleton height={90} style={{ borderRadius: radius.lg }} /><Skeleton height={130} style={{ borderRadius: radius.lg }} /></>;

  const availableVehicles = vehicles.filter((v) => v.status === "available" || data?.loads.some((l) => l.vehicle_id === v.id && !["DELIVERED", "CANCELLED"].includes(l.status)));

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">Delivery Loads</AppText>
          <AppText variant="caption">
            Ordered {data?.ordered_quantity_m3 || 0} m³ · Planned {data?.planned_quantity_m3 || 0} m³ · Delivered {data?.delivered_quantity_m3 || 0} m³
          </AppText>
        </View>
        {(data?.remaining_quantity_m3 || 0) > 0 ? (
          <Pressable onPress={() => { setQty(String(data?.remaining_quantity_m3 || "")); setAddOpen(true); }} style={{ width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand }}>
            <Ionicons name="add" size={20} color={colors.onBrand} />
          </Pressable>
        ) : null}
      </View>

      {data?.loads.length ? data.loads.map((load) => (
        <Card key={load.id} style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{load.load_code}</AppText>
              <AppText variant="caption">{load.quantity_m3} m³{load.delivered_quantity ? ` · Delivered ${load.delivered_quantity} m³` : ""}</AppText>
            </View>
            <Badge label={load.status.replace(/_/g, " ")} status={load.status} />
          </View>

          {(load.tm_number || load.driver_name) ? (
            <AppText variant="caption">{[load.tm_number, load.driver_name].filter(Boolean).join(" · ")}</AppText>
          ) : null}
          {load.challan_number ? <AppText variant="caption">Challan: {load.challan_number}</AppText> : null}
          {load.gate_pass_number ? <AppText variant="caption">Gate pass: {load.gate_pass_number}</AppText> : null}

          {["PLANNED", "ASSIGNED"].includes(load.status) ? (
            <Button label={load.status === "ASSIGNED" ? "Change Assignment" : "Assign TM + Driver"} variant="outline" onPress={() => openAssign(load)} />
          ) : null}
          {load.status === "ASSIGNED" ? (
            <Button label="Prepare Trip + Challan" onPress={() => action(`/loads/${load.id}/prepare`, "Load prepared", {})} loading={busy} />
          ) : null}
          {load.status === "READY_TO_DISPATCH" && !load.gate_pass_number ? (
            <Button label="Issue Gate Pass" onPress={() => action("/loads/gate-pass", "Gate pass issued", { load_id: load.id })} loading={busy} />
          ) : null}
          {load.status === "READY_TO_DISPATCH" && load.gate_pass_number ? (
            <Button label="Dispatch Load" onPress={() => action(`/loads/${load.id}/dispatch`, "Load dispatched")} loading={busy} />
          ) : null}
          {["PLANNED", "ASSIGNED"].includes(load.status) ? (
            <Button label="Cancel Load" variant="outline" onPress={() => action(`/loads/${load.id}/cancel`, "Load cancelled")} />
          ) : null}
        </Card>
      )) : <Card><AppText variant="bodyMuted">No mixer loads planned yet.</AppText></Card>}

      {(data?.remaining_quantity_m3 || 0) > 0 ? (
        <AppText variant="caption">Remaining to plan: {data?.remaining_quantity_m3} m³</AppText>
      ) : null}

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.md }}>
            <AppText variant="heading">Plan Mixer Load</AppText>
            <Input label="Quantity (m³)" value={qty} onChangeText={(v) => setQty(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" />
            <Button label="Add Load" onPress={createLoad} loading={busy} />
            <Button label="Cancel" variant="outline" onPress={() => setAddOpen(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={!!assigning} transparent animationType="slide" onRequestClose={() => setAssigning(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ maxHeight: "86%", backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.md }}>
            <AppText variant="heading">Assign {assigning?.load_code}</AppText>
            <AppText variant="label">Transit mixer</AppText>
            <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ gap: spacing.sm }}>
              {availableVehicles.map((v) => {
                const selected = vehicleId === v.id;
                return (
                  <Pressable key={v.id} onPress={() => setVehicleId(v.id)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: selected ? colors.brand : colors.border, backgroundColor: selected ? colors.brandSoft : colors.surfaceSecondary }}>
                    <Ionicons name="bus-outline" size={18} color={selected ? colors.brand : colors.onSurfaceSecondary} />
                    <AppText style={{ flex: 1 }}>{v.tm_number} · {v.capacity_m3} m³</AppText>
                    <AppText variant="caption">{v.status}</AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
            <AppText variant="label">Driver</AppText>
            <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ gap: spacing.sm }}>
              {drivers.map((d) => {
                const selected = driverId === d.id;
                return (
                  <Pressable key={d.id} onPress={() => setDriverId(d.id)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: selected ? colors.brand : colors.border, backgroundColor: selected ? colors.brandSoft : colors.surfaceSecondary }}>
                    <Ionicons name="person-outline" size={18} color={selected ? colors.brand : colors.onSurfaceSecondary} />
                    <AppText style={{ flex: 1 }}>{d.name}</AppText>
                    {d.phone ? <AppText variant="caption">{d.phone}</AppText> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button label="Save Assignment" onPress={saveAssignment} loading={busy} />
            <Button label="Cancel" variant="outline" onPress={() => setAssigning(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
