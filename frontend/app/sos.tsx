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
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { getCurrentDeviceLocation } from "@/src/location/currentLocation";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const TYPES: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "Emergency", label: "Emergency", icon: "warning-outline" },
  { key: "Accident", label: "Accident", icon: "car-sport-outline" },
  { key: "Breakdown", label: "Vehicle Breakdown", icon: "construct-outline" },
  { key: "Safety", label: "Safety Issue", icon: "shield-outline" },
];

export default function Sos() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [type, setType] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!type) return toast("Select an emergency type", "error");
    setBusy(true);
    try {
      const location = await getCurrentDeviceLocation();
      const payload = {
        type,
        remark: remark.trim() || null,
        lat: location.ok ? location.location.lat : null,
        lng: location.ok ? location.location.lng : null,
      };

      const res: any = await apiPost("/driver/sos", token!, payload);
      if (!location.ok) {
        toast(
          res.supervisor_notified
            ? "SOS sent — supervisor notified; current location was unavailable"
            : "SOS recorded; current location was unavailable",
          "success",
        );
      } else {
        toast(res.supervisor_notified ? "SOS sent — supervisor notified" : "SOS recorded", "success");
      }
      router.back();
    } catch (e: any) {
      toast(e.detail || "Could not send SOS", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="sos-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">Raise SOS</AppText>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <View style={[styles.alert, { backgroundColor: colors.error + "1A", borderColor: colors.error + "55" }]}>
          <Ionicons name="alert-circle" size={22} color={colors.error} />
          <AppText variant="caption" style={{ flex: 1 }}>
            Use only for genuine emergencies. We attach your current device location when available, but the SOS can still be sent if location is unavailable.
          </AppText>
        </View>
        <AppText variant="heading">What&apos;s the emergency?</AppText>
        <View style={{ gap: spacing.sm }}>
          {TYPES.map((t) => {
            const sel = t.key === type;
            return (
              <Pressable key={t.key} testID={`sos-type-${t.key}`} onPress={() => setType(t.key)} style={[styles.type, { borderColor: sel ? colors.error : colors.border, backgroundColor: sel ? colors.error + "1A" : colors.surfaceSecondary }]}>
                <Ionicons name={t.icon} size={22} color={sel ? colors.error : colors.onSurfaceSecondary} />
                <AppText style={{ flex: 1, fontFamily: fonts.semibold, fontSize: fontSize.base, color: colors.onSurface }}>{t.label}</AppText>
                <Ionicons name={sel ? "radio-button-on" : "radio-button-off"} size={20} color={sel ? colors.error : colors.onSurfaceTertiary} />
              </Pressable>
            );
          })}
        </View>
        <Input testID="sos-remark" label="Add a note (optional)" value={remark} onChangeText={setRemark} placeholder="Briefly describe the situation" autoCapitalize="sentences" />
        <Button testID="sos-submit" label="Send SOS Now" variant="danger" loading={busy} onPress={submit} icon={<Ionicons name="megaphone-outline" size={18} color="#fff" />} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  alert: { flexDirection: "row", gap: spacing.sm, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  type: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
});
