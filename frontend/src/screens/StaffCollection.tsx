import React, { useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Badge } from "@/src/components/ui/Badge";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { ErrorView } from "@/src/components/StateViews";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export type StaffAction = {
  key: string;
  label: string;
  style?: "primary" | "danger" | "outline";
  method?: string;
  path?: string;
  body?: Record<string, unknown>;
  input?: "amount" | "reason" | "quality";
  sign?: number;
};

export type StaffItem = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary: string;
  secondary?: string | null;
  meta?: string | null;
  badge?: string | null;
  badge_status?: string | null;
  actions?: StaffAction[];
  nav?: Href | null;
  owner_assigned?: boolean;
};

type CreateDef = { label: string; path: string; form: "material" | "vehicle" };
type CollectionData = { title: string; empty: string; items: StaffItem[]; create?: CreateDef };

function ItemRow({ item, onAction, onPress }: { item: StaffItem; onAction: (i: StaffItem, a: StaffAction) => void; onPress?: () => void }) {
  const { colors } = useTheme();
  const rowContent = (
    <>
      <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
        <Ionicons name={item.icon || "ellipse-outline"} size={18} color={colors.onBrandSoft} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }} numberOfLines={1}>{item.primary}</AppText>
        {item.secondary ? <AppText variant="caption" numberOfLines={1}>{item.secondary}</AppText> : null}
        {item.meta ? <AppText style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceTertiary }} numberOfLines={1}>{item.meta}</AppText> : null}
      </View>
      {item.badge ? <Badge label={item.badge} status={item.badge_status || item.badge} /> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} /> : null}
    </>
  );

  return (
    <View style={styles.rowWrap}>
      {onPress ? (
        <Pressable style={styles.row} onPress={onPress} testID={`open-${item.id}`}>
          {rowContent}
        </Pressable>
      ) : (
        <View style={styles.row}>{rowContent}</View>
      )}
      {item.actions && item.actions.length > 0 ? (
        <View style={styles.actions}>
          {item.actions.map((a) => (
            <Pressable
              key={a.key}
              testID={`action-${a.key}-${item.id}`}
              onPress={() => onAction(item, a)}
              style={[
                styles.actionBtn,
                a.style === "danger"
                  ? { backgroundColor: colors.error + "1A", borderColor: colors.error + "55" }
                  : a.style === "outline"
                  ? { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }
                  : { backgroundColor: colors.brand, borderColor: colors.brand },
              ]}
            >
              <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, color: a.style === "danger" ? colors.error : a.style === "outline" ? colors.onSurface : colors.onBrand }}>
                {a.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function StaffCollection({ kind, embedded = false, limit, onItemPress }: { kind: string; embedded?: boolean; limit?: number; onItemPress?: (item: StaffItem) => void }) {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { data, loading, error, refetch, reload } = useGet<CollectionData>(`/staff/collection/${kind}`);

  const [modal, setModal] = useState<{ item?: StaffItem; action?: StaffAction; create?: CreateDef } | null>(null);
  const [num, setNum] = useState("");
  const [text, setText] = useState("");
  const [f1, setF1] = useState("");
  const [f2, setF2] = useState("");
  const [f3, setF3] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const allItems = data?.items || [];
  const badges = useMemo(() => {
    const seen = new Set<string>();
    allItems.forEach((i) => i.badge && seen.add(i.badge));
    return Array.from(seen);
  }, [allItems]);

  const searchable = !embedded && !limit;
  const filtered = useMemo(() => {
    if (!searchable) return limit ? allItems.slice(0, limit) : allItems;
    const q = query.trim().toLowerCase();
    return allItems.filter((i) => {
      if (statusFilter && i.badge !== statusFilter) return false;
      if (!q) return true;
      return [i.primary, i.secondary, i.meta].some((f) => (f || "").toLowerCase().includes(q));
    });
  }, [allItems, query, statusFilter, searchable, limit]);

  const items = filtered;

  const runPost = async (path: string, body?: Record<string, unknown>) => {
    if (!token) {
      toast("Please sign in again", "error");
      return;
    }

    setBusy(true);
    try {
      await apiPost(path, token, body);
      toast("Done", "success");
      setModal(null);
      setNum(""); setText(""); setF1(""); setF2(""); setF3("");
      refetch();
    } catch (error: unknown) {
      toast(apiErrorDetail(error, "Action failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const onAction = (item: StaffItem, action: StaffAction) => {
    if (action.input === "quality") {
      router.push({ pathname: "/quality-test/[id]", params: { id: item.id } });
      return;
    }
    if (action.input === "amount" || action.input === "reason") {
      setNum(""); setText("");
      setModal({ item, action });
      return;
    }
    if (!action.path) {
      toast("Action unavailable", "error");
      return;
    }
    void runPost(action.path, action.body);
  };

  const openCreate = () => {
    if (!data?.create) return;
    setF1(""); setF2(""); setF3("");
    setNum(""); setText("");
    setModal({ create: data.create });
  };

  const submitModal = () => {
    if (modal?.create) {
      if (modal.create.form === "material") {
        if (!f1.trim() || !f2.trim()) return toast("Name and unit required", "error");
        return runPost(modal.create.path, { name: f1.trim(), unit: f2.trim(), stock: Number(num || 0), reorder: Number(f3 || 0) });
      }
      if (!f1.trim() || !num) return toast("TM number and capacity required", "error");
      return runPost(modal.create.path, { tm_number: f1.trim(), capacity_m3: Number(num) });
    }

    const action = modal?.action;
    if (!action?.path) return toast("Action unavailable", "error");
    if (action.input === "amount") {
      const amt = Number(num);
      if (!amt || amt <= 0) return toast("Enter a valid amount", "error");
      return runPost(action.path, { delta: amt * (action.sign || 1), amount: amt, note: text.trim() || null });
    }
    return runPost(action.path, { reason: text.trim() || null });
  };

  const body = (
    <>
      {loading && !data ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={70} style={{ borderRadius: radius.lg }} />
          <Skeleton height={70} style={{ borderRadius: radius.lg }} />
        </View>
      ) : data && items.length === 0 ? (
        <Card style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm }}>
          <Ionicons name="file-tray-outline" size={30} color={colors.onSurfaceTertiary} />
          <AppText variant="bodyMuted">{data.empty}</AppText>
        </Card>
      ) : (
        <Card padded={false}>
          {items.map((it, i) => {
            const nav = it.nav;
            const itemPress = onItemPress
              ? () => onItemPress(it)
              : nav
              ? () => router.push(nav)
              : undefined;

            return (
              <View key={it.id} style={i < items.length - 1 && { borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }}>
                <ItemRow item={it} onAction={onAction} onPress={itemPress} />
              </View>
            );
          })}
        </Card>
      )}
    </>
  );

  const modalUI = (
    <Modal visible={!!modal} transparent animationType="fade" onRequestClose={() => setModal(null)}>
      <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
          <AppText variant="heading">
            {modal?.create ? modal.create.label : modal?.action?.label}
          </AppText>
          {modal?.create?.form === "material" ? (
            <>
              <Input label="Material name" value={f1} onChangeText={setF1} placeholder="e.g. Cement (OPC 53)" />
              <Input label="Unit" value={f2} onChangeText={setF2} placeholder="MT / L / bags" />
              <Input label="Opening stock" value={num} onChangeText={(t) => setNum(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" />
              <Input label="Reorder level" value={f3} onChangeText={(t) => setF3(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" />
            </>
          ) : modal?.create?.form === "vehicle" ? (
            <>
              <Input label="TM number" value={f1} onChangeText={setF1} placeholder="e.g. TS09UB4321" autoCapitalize="characters" />
              <Input label="Capacity (m³)" value={num} onChangeText={(t) => setNum(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" />
            </>
          ) : modal?.action?.input === "amount" ? (
            <>
              <Input label="Quantity" value={num} onChangeText={(t) => setNum(t.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="0" />
              <Input label="Note (optional)" value={text} onChangeText={setText} placeholder="e.g. supplier delivery" />
            </>
          ) : (
            <Input label="Reason (optional)" value={text} onChangeText={setText} placeholder="Why is this rejected?" />
          )}
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}><Button testID="modal-cancel" label="Cancel" variant="outline" onPress={() => setModal(null)} /></View>
            <View style={{ flex: 1 }}><Button testID="modal-confirm" label="Confirm" onPress={submitModal} loading={busy} /></View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

  if (embedded) return <>{body}{modalUI}</>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      {error && !data ? (
        <ErrorView message={error} onRetry={reload} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}
        >
          <View style={styles.head}>
            <AppText variant="title">{data?.title || "List"}</AppText>
            {data?.create ? (
              <Pressable testID="staff-create" onPress={openCreate} style={[styles.addBtn, { backgroundColor: colors.brand }]}>
                <Ionicons name="add" size={18} color={colors.onBrand} />
                <AppText style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.onBrand }}>{data.create.label}</AppText>
              </Pressable>
            ) : null}
          </View>
          {allItems.length >= 4 ? (
            <View style={[styles.search, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
              <TextInput
                testID="staff-search"
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={{ flex: 1, fontFamily: fonts.regular, fontSize: fontSize.base, color: colors.onSurface, paddingVertical: 0 }}
              />
              {query ? (
                <Pressable testID="staff-search-clear" onPress={() => setQuery("")}>
                  <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {badges.length >= 2 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {[null, ...badges].map((b) => {
                const sel = statusFilter === b;
                return (
                  <Pressable
                    key={b || "all"}
                    testID={`staff-filter-${b || "all"}`}
                    onPress={() => setStatusFilter(b)}
                    style={[styles.chip, { backgroundColor: sel ? colors.brand : colors.surfaceSecondary, borderColor: sel ? colors.brand : colors.border }]}
                  >
                    <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, color: sel ? colors.onBrand : colors.onSurfaceSecondary }}>{b || "All"}</AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          {body}
        </ScrollView>
      )}
      {modalUI}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, height: 38, borderRadius: radius.pill },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, height: 44, borderRadius: radius.md, borderWidth: 1 },
  chip: { height: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowWrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm, marginLeft: 50 },
  actionBtn: { paddingHorizontal: spacing.md, height: 36, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  sheet: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
});