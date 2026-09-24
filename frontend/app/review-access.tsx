import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PlayReviewRole } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { roleRouteFor } from "@/src/auth/roleRoutes";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";

const ROLES: { role: PlayReviewRole; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { role: "customer", label: "User / Customer", description: "Customer ordering and delivery experience", icon: "person-outline" },
  { role: "plant_owner", label: "Plant Owner", description: "Plant operations and owner dashboard", icon: "business-outline" },
  { role: "driver", label: "Driver", description: "Trip, live delivery tracking and POD", icon: "car-outline" },
];

const REVIEW_GUIDANCE: Record<PlayReviewRole, { title: string; text: string }> = {
  customer: {
    title: "Nearby Plants review path",
    text: "After login, open Nearby Plants. TrackMyRMC shows an in-app location explanation before Android asks for location. The seeded TrackMyRMC Play Review Plant remains visible even if you choose Not now.",
  },
  plant_owner: {
    title: "Plant Owner review path",
    text: "After login, the isolated review plant, vehicle and review-only operational data are available from the Plant Owner dashboard.",
  },
  driver: {
    title: "Background location review path",
    text: "After login, open Current Trip PLAY-REVIEW-001. Before Android asks for location, TrackMyRMC shows the prominent delivery-location disclosure. Continue to see the foreground and background permission flow used only for an active delivery.",
  },
};

export default function ReviewAccess() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { verifyPlayReview } = useAuth();
  const [role, setRole] = useState<PlayReviewRole>("customer");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit fixed reviewer OTP supplied in Google Play Console.");
      return;
    }
    setBusy(true);
    try {
      const me = await verifyPlayReview(role, code.trim());
      router.replace(roleRouteFor(me.role) as any);
    } catch (e: any) {
      setError(e.detail || "Reviewer access failed");
    } finally {
      setBusy(false);
    }
  };

  const guidance = REVIEW_GUIDANCE[role];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable onPress={() => router.back()} style={[styles.back, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Google Play Review Access</AppText>
          <AppText variant="caption">Reusable reviewer OTP — isolated review accounts only</AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 }}>
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="heading">Choose a review role</AppText>
          <AppText variant="bodyMuted">
            These accounts contain review-only demo data. The fixed six-digit reviewer OTP works only while Play reviewer access is explicitly enabled on the server.
          </AppText>
        </Card>

        <Card testID="play-review-background-location-route" style={{ gap: spacing.sm, backgroundColor: colors.brandSoft, borderColor: colors.brand + "44" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Ionicons name="location-outline" size={20} color={colors.brand} />
            <AppText variant="label">Reviewing BACKGROUND_LOCATION?</AppText>
          </View>
          <AppText variant="bodyMuted">
            Background location applies only to active Driver deliveries. Select Driver below, sign in, then open Current Trip PLAY-REVIEW-001 to see TrackMyRMC&apos;s prominent disclosure before Android permission prompts.
          </AppText>
        </Card>

        <View style={{ gap: spacing.sm }}>
          {ROLES.map((item) => {
            const selected = role === item.role;
            return (
              <Pressable
                key={item.role}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setRole(item.role);
                  setError(null);
                }}
                style={[
                  styles.roleCard,
                  {
                    borderColor: selected ? colors.brand : colors.border,
                    backgroundColor: selected ? colors.brandSoft : colors.surfaceSecondary,
                  },
                ]}
              >
                <Ionicons name={item.icon} size={22} color={selected ? colors.onBrandSoft : colors.brand} />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="label">{item.label}</AppText>
                  <AppText variant="caption">{item.description}</AppText>
                </View>
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={selected ? colors.brand : colors.onSurfaceTertiary}
                />
              </Pressable>
            );
          })}
        </View>

        <Card testID="play-review-guidance" style={{ gap: spacing.sm, backgroundColor: colors.brandSoft, borderColor: colors.brand + "44" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Ionicons name="information-circle-outline" size={20} color={colors.brand} />
            <AppText variant="label">{guidance.title}</AppText>
          </View>
          <AppText variant="bodyMuted">{guidance.text}</AppText>
        </Card>

        <Input
          label="6-digit reviewer OTP"
          value={code}
          onChangeText={(value) => {
            setCode(value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          placeholder="••••••"
          keyboardType="number-pad"
          maxLength={6}
          secureTextEntry
          error={error || undefined}
        />
        <Button label={`Open ${ROLES.find((item) => item.role === role)?.label}`} onPress={login} loading={busy} disabled={code.length !== 6} />

        <AppText variant="caption" center>
          Normal users must use the standard User Login or Plant Staff Login flow. Reviewer OTP access does not bypass normal accounts.
        </AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  roleCard: {
    minHeight: 72,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
});