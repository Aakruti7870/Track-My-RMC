import React, { useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Site = {
  id: string;
  name: string;
  address: string;
  contact_person?: string | null;
  contact_mobile?: string | null;
  notes?: string | null;
  is_default?: boolean;
};

type SitesResponse = { sites: Site[] };

export default function CustomerSites() {
  const { token } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { data, loading, refetch } = useGet<SitesResponse>("/master/customer/sites");
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");
  const [mobile, setMobile] = useState("");
  const [notes, setNotes] = useState("");

  const create = async () => {
    if (!token) return;
    if (!name.trim() || !address.trim()) return toast("Site name and address are required", "error");
    setBusy(true);
    try {
      await apiPost("/master/customer/sites", token, {
        name: name.trim(),
        address: address.trim(),
        contact_person: contact.trim() || null,
        contact_mobile: mobile.trim() || null,
        notes: notes.trim() || null,
        is_default: (data?.sites?.length || 0) === 0,
      });
      setModal(false);
      setName(""); setAddress(""); setContact(""); setMobile(""); setNotes("");
      toast("Site saved", "success");
      refetch();
    } catch (e: any) {
      toast(e.detail || "Could not save site", "error");
    } finally { setBusy(false); }
  };

  const remove = async (site: Site) => {
    if (!token) return;
    setBusy(true);
    try {
      await apiDelete(`/master/customer/sites/${site.id}`, token);
      toast("Site removed", "success");
      refetch();
    } catch (e: any) { toast(e.detail || "Could not remove site", "error"); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.brand} />}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
          <View style={{ flex: 1 }}><AppText variant="title">Saved Sites</AppText><AppText variant="caption">Reuse delivery addresses when placing RMC orders</AppText></View>
          <Pressable onPress={() => setModal(true)} style={[styles.add, { backgroundColor: colors.brand }]}><Ionicons name="add" size={20} color={colors.onBrand} /></Pressable>
        </View>

        {loading && !data ? <><Skeleton height={90} /><Skeleton height={90} /></> : null}
        {data?.sites?.map((site) => (
          <Card key={site.id} style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
              <Ionicons name="location-outline" size={20} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{site.name}{site.is_default ? " · Default" : ""}</AppText>
                <AppText variant="caption">{site.address}</AppText>
              </View>
            </View>
            {site.contact_person || site.contact_mobile ? <AppText variant="caption">{[site.contact_person, site.contact_mobile].filter(Boolean).join(" · ")}</AppText> : null}
            <Button label="Remove" variant="outline" onPress={() => remove(site)} loading={busy} />
          </Card>
        ))}
        {data && data.sites.length === 0 ? <Card><AppText variant="bodyMuted">No saved sites yet.</AppText></Card> : null}
      </ScrollView>

      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
              <AppText variant="heading">Add Delivery Site</AppText>
              <Input label="Site name" value={name} onChangeText={setName} placeholder="Project / site name" />
              <Input label="Address" value={address} onChangeText={setAddress} placeholder="Full delivery address" />
              <Input label="Contact person" value={contact} onChangeText={setContact} />
              <Input label="Contact mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
              <Input label="Notes" value={notes} onChangeText={setNotes} />
              <Button label="Save Site" onPress={create} loading={busy} />
              <Button label="Cancel" variant="outline" onPress={() => setModal(false)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  add: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "85%", borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
});
