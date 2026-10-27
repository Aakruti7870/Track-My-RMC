import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiGet, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";

type PlantRequest = {
  id: string;
  request_number: string;
  source: string;
  google_place_id: string | null;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
  contact_phone: string | null;
  status: string;
  applicant_owner_name: string | null;
  applicant_email: string | null;
  applicant_mobile: string | null;
  preferred_plan_months?: 1 | 3 | 6 | 12 | null;
  created_at: string;
};

type RequestsResponse = { success: boolean; requests: PlantRequest[] };

export default function AdminPlantOnboardingReview() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user, hydrating } = useAuth();

  const [requests, setRequests] = useState<PlantRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlantRequest | null>(null);
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [pincode, setPincode] = useState("");
  const [plantCode, setPlantCode] = useState("");

  const loadRequests = useCallback(async (refresh = false) => {
    if (!token || user?.role !== "admin") return;
    setError(null);
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await apiGet<RequestsResponse>("/plant-discovery/requests", token);
      setRequests(response.requests || []);
    } catch (e) {
      setError(apiErrorDetail(e, "Could not load plant onboarding requests."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, user?.role]);

  useEffect(() => {
    if (token && user?.role === "admin") void loadRequests();
  }, [token, user?.role, loadRequests]);

  const openApproval = (item: PlantRequest) => {
    setSelected(item);
    setCity(item.city || "");
    setRegion(item.state || "");
    setPincode("");
    setPlantCode(item.request_number);
    setError(null);
  };

  const approve = async () => {
    if (!selected || !token) return;
    if (city.trim().length < 2 || region.trim().length < 2 || pincode.trim().length < 4) {
      setError("Enter the plant city, state and PIN code before approving.");
      return;
    }
    setWorkingId(selected.id);
    setError(null);
    try {
      await apiPost("/plant-discovery/requests/" + selected.id + "/approve", token, {
        city: city.trim(),
        state: region.trim(),
        pincode: pincode.trim(),
        plant_code: plantCode.trim() || selected.request_number,
      });
      setSelected(null);
      await loadRequests(true);
      Alert.alert("Plant approved", "The Plant Owner account and plant record were created or matched successfully.");
    } catch (e) {
      setError(apiErrorDetail(e, "Could not approve this plant request."));
    } finally {
      setWorkingId(null);
    }
  };

  const reject = (item: PlantRequest) => {
    Alert.alert(
      "Reject plant request?",
      "Reject " + item.request_number + " — " + item.name + "? The request will remain in the audit history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: () => {
            if (!token) return;
            setWorkingId(item.id);
            setError(null);
            void apiPost("/plant-discovery/requests/" + item.id + "/reject", token, {})
              .then(async () => {
                await loadRequests(true);
              })
              .catch((e) => setError(apiErrorDetail(e, "Could not reject this plant request.")))
              .finally(() => setWorkingId(null));
          },
        },
      ],
    );
  };

  if (hydrating) {
    return (
      <View style={[styles.center, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!user || user.role !== "admin" || !token) return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={[styles.backButton, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={21} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="title">Plant Onboarding</AppText>
          <AppText variant="caption">Review requests before activating a Plant Owner</AppText>
        </View>
        <View style={[styles.countBadge, { backgroundColor: colors.brandSoft }]}>
          <AppText style={{ color: colors.brand, fontWeight: "700" }}>{requests.length}</AppText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadRequests(true)} />}
      >
        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.error + "12", borderColor: colors.error + "66" }]}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
            <AppText variant="caption" color={colors.error} style={{ flex: 1 }}>{error}</AppText>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
        ) : requests.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="checkmark-done-circle-outline" size={42} color={colors.success} />
            <AppText variant="heading">No pending requests</AppText>
            <AppText variant="bodyMuted" center>New partner submissions will appear here for administrator review.</AppText>
            <Button label="Refresh" variant="outline" onPress={() => void loadRequests(true)} />
          </Card>
        ) : requests.map((item) => (
          <Card key={item.id} testID={"plant-request-" + item.id} style={{ gap: spacing.md }}>
            <View style={styles.requestTitle}>
              <View style={{ flex: 1, gap: 3 }}>
                <AppText variant="label">{item.name}</AppText>
                <AppText variant="caption">{item.request_number} · {item.source.replace(/_/g, " ")}</AppText>
              </View>
              <View style={[styles.pendingBadge, { backgroundColor: colors.warning + "18" }]}>
                <AppText style={{ color: colors.warning, fontSize: 11, fontWeight: "700" }}>PENDING</AppText>
              </View>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="person-outline" size={17} color={colors.onSurfaceSecondary} />
              <AppText variant="body" style={{ flex: 1 }}>{item.applicant_owner_name || "Owner name not supplied"}</AppText>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="mail-outline" size={17} color={colors.onSurfaceSecondary} />
              <AppText variant="body" style={{ flex: 1 }}>{item.applicant_email || "Email not supplied"}</AppText>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="call-outline" size={17} color={colors.onSurfaceSecondary} />
              <AppText variant="body" style={{ flex: 1 }}>{item.applicant_mobile || item.contact_phone || "Mobile not supplied"}</AppText>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="calendar-outline" size={17} color={colors.onSurfaceSecondary}/>
              <AppText variant="body" style={{ flex: 1 }}>
                Plan interest: {item.preferred_plan_months ? `${item.preferred_plan_months} month${item.preferred_plan_months === 1 ? "" : "s"}` : "Not selected (legacy request)"}
              </AppText>
            </View>
            <AppText variant="caption">Pricing and payment instructions must be sent separately after review. This request is not a paid subscription.</AppText>
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={17} color={colors.onSurfaceSecondary} />
              <AppText variant="body" style={{ flex: 1 }}>{item.address}</AppText>
            </View>
            <AppText variant="caption">Coordinates: {item.lat.toFixed(5)}, {item.lng.toFixed(5)}</AppText>
            {item.google_place_id ? <AppText variant="caption">Google Place ID: {item.google_place_id}</AppText> : null}
            <View style={styles.actionRow}>
              <Button
                label="Approve"
                onPress={() => openApproval(item)}
                loading={workingId === item.id}
                disabled={workingId !== null}
              />
              <Button
                label="Reject"
                variant="outline"
                onPress={() => reject(item)}
                loading={workingId === item.id}
                disabled={workingId !== null}
              />
            </View>
          </Card>
        ))}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <AppText variant="heading">Approve plant request</AppText>
            <AppText variant="caption">{selected?.request_number} · {selected?.name}</AppText>
            <Input label="City" value={city} onChangeText={setCity} placeholder="Plant city" />
            <Input label="State" value={region} onChangeText={setRegion} placeholder="State" />
            <Input label="PIN code" value={pincode} onChangeText={setPincode} placeholder="PIN code" keyboardType="default" />
            <Input label="Plant code" value={plantCode} onChangeText={setPlantCode} placeholder="Unique plant code" autoCapitalize="characters" />
            {error ? <AppText variant="caption" color={colors.error}>{error}</AppText> : null}
            <Button label="Confirm approval" onPress={approve} loading={!!selected && workingId === selected.id} />
            <Button label="Cancel" variant="outline" onPress={() => setSelected(null)} disabled={!!workingId} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.lg, paddingBottom: 120, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  countBadge: { minWidth: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  emptyCard: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  requestTitle: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  pendingBadge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  errorBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.lg, paddingBottom: 36, gap: spacing.md },
});
