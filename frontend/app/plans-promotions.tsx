import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { useGet } from "@/src/hooks/useApi";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fontSize, radius, spacing } from "@/src/theme/tokens";

type OwnerPlantPromotionSummary = {
  plant_id: string;
  plant_name: string;
  city?: string | null;
  promotion_status?: "ACTIVE" | "PAUSED" | "EXPIRED" | "REVOKED" | null;
  radius_km?: number | null;
  ends_at?: string | null;
  latest_enquiry_status?: "PENDING" | "CONTACTED" | "ACTIVATED" | "REJECTED" | null;
  latest_enquiry_created_at?: string | null;
};

type OwnerPromotionsResponse = {
  default_radius_km: number;
  rotation_interval_seconds: number;
  plants: OwnerPlantPromotionSummary[];
};

const DURATION_OPTIONS = [7, 15, 30] as const;

/**
 * Owner plans and promotions use administrative onboarding and individual
 * commercial review, never an in-app Cashfree/digital subscription checkout.
 * Customer purchases of physical ready-mix concrete have a separate flow.
 */
export default function PlansPromotions() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, refetch } = useGet<OwnerPromotionsResponse>("/owner/promotions");

  const plants = data?.plants ?? [];
  const [selectedPlantId, setSelectedPlantId] = useState<string>("");
  const [durationDays, setDurationDays] = useState<number>(30);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!selectedPlantId && plants.length > 0) {
      setSelectedPlantId(plants[0].plant_id);
    }
  }, [plants, selectedPlantId]);

  const selectedPlant = plants.find(p => p.plant_id === selectedPlantId) ?? plants[0] ?? null;

  const submitPromotionEnquiry = async () => {
    if (!token) {
      setFeedback({ kind: "error", message: "Please sign in as a Plant Owner to request a promotion." });
      return;
    }
    if (!selectedPlant) {
      setFeedback({ kind: "error", message: "No approved plant found on your account yet. Complete onboarding first." });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await apiPost("/owner/promotions/enquiries", token, {
        plant_id: selectedPlant.plant_id,
        requested_radius_km: 30,
        preferred_duration_days: durationDays,
        notes: notes.trim() || undefined,
      });
      setNotes("");
      setFeedback({
        kind: "success",
        message:
          `Promotion enquiry submitted for ${selectedPlant.plant_name} (30 km radius). ` +
          "A confirmation notification has been sent to your notifications and to TrackMyRMC Super Admin for activation.",
      });
      refetch();
    } catch (error: unknown) {
      setFeedback({
        kind: "error",
        message: apiErrorDetail(error, "Could not submit promotion enquiry right now. Please try again."),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const contactSupport = async () => {
    const address = "mailto:support@trackmyrmc.com?subject=TrackMyRMC%20Plant%20Owner%20Enquiry";
    try {
      await Linking.openURL(address);
    } catch {
      // The email address remains visible for users without an email app.
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      style={{ flex: 1, backgroundColor: colors.surface }}
    >
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.header}
      >
        <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        <AppText variant="title">Plans &amp; Promotions</AppText>
      </Pressable>

      <Card style={{ gap: spacing.md }}>
        <View style={styles.titleRow}>
          <Ionicons name="megaphone-outline" size={22} color={colors.brand} />
          <AppText variant="heading">Top-Listing Plant Promotion (30 km Radius)</AppText>
        </View>
        <AppText variant="bodyMuted">
          Request priority top-listing visibility for your plant within a 30 km radius. Because automated
          payment webhooks are currently unavailable, clicking below sends an enquiry to TrackMyRMC
          Super Admin and delivers a confirmation notification to your account. Only Super Admin can
          activate promotions and customize the visibility radius.
        </AppText>
        <AppText variant="caption">
          When more than one plant has an active promotion in the same area, promoted plants rotate
          automatically every 2 minutes for fair top visibility.
        </AppText>

        {plants.length > 0 ? (
          <View style={{ gap: spacing.xs }}>
            <AppText variant="label">Select Plant</AppText>
            <View style={styles.chipRow}>
              {plants.map(plant => {
                const active = plant.plant_id === selectedPlant?.plant_id;
                return (
                  <Pressable
                    key={plant.plant_id}
                    onPress={() => setSelectedPlantId(plant.plant_id)}
                    style={[
                      styles.chip,
                      {
                        borderColor: active ? colors.brand : colors.border,
                        backgroundColor: active ? colors.brandSoft : colors.surfaceSecondary,
                      },
                    ]}
                  >
                    <AppText variant="label">{plant.plant_name}</AppText>
                    {plant.promotion_status === "ACTIVE" ? (
                      <AppText variant="caption" style={{ color: colors.brand }}>
                        Active ({plant.radius_km ?? 30} km)
                      </AppText>
                    ) : plant.latest_enquiry_status === "PENDING" ? (
                      <AppText variant="caption">Enquiry Pending</AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={{ gap: spacing.xs }}>
          <AppText variant="label">Preferred Duration</AppText>
          <View style={styles.chipRow}>
            {DURATION_OPTIONS.map(days => {
              const active = durationDays === days;
              return (
                <Pressable
                  key={days}
                  onPress={() => setDurationDays(days)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? colors.brand : colors.border,
                      backgroundColor: active ? colors.brandSoft : colors.surfaceSecondary,
                    },
                  ]}
                >
                  <AppText variant="label">{days} Days</AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional note for TrackMyRMC Super Admin (e.g. target zones or dates)"
          placeholderTextColor={colors.onSurfaceSecondary}
          multiline
          style={[
            styles.input,
            {
              color: colors.onSurface,
              borderColor: colors.border,
              backgroundColor: colors.surfaceSecondary,
            },
          ]}
        />

        {feedback ? (
          <View
            style={[
              styles.banner,
              {
                borderColor: feedback.kind === "success" ? colors.brand : colors.border,
                backgroundColor: colors.surfaceSecondary,
              },
            ]}
          >
            <AppText variant="bodyMuted">{feedback.message}</AppText>
          </View>
        ) : null}

        <View testID="request-plant-promotion-button">
          <Button
            label={submitting ? "Sending Promotion Enquiry..." : "Request 30 km Promotion"}
            onPress={submitPromotionEnquiry}
            disabled={submitting}
          />
        </View>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <AppText variant="heading">Individual plant onboarding and offers</AppText>
        <AppText variant="bodyMuted">
          TrackMyRMC reviews each RMC plant&apos;s registration documents, operational requirements,
          subscription duration and any promotional requirements before proposing commercial terms.
        </AppText>
        <AppText variant="bodyMuted">
          No subscription, promotion, website activation or AI automation payment is collected
          through this app. The TrackMyRMC team will discuss any approved offer directly with you.
        </AppText>
        <Button label="Open Onboarding Form" onPress={() => router.push("/plant-onboarding" as any)} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <AppText variant="heading">Contact TrackMyRMC Support</AppText>
        <AppText variant="bodyMuted">
          For document verification, plan enquiries and personalized service quotations:
        </AppText>
        <AppText style={{ color: colors.brand, fontSize: fontSize.base }}>
          support@trackmyrmc.com
        </AppText>
        <Button label="Email Support" onPress={contactSupport} />
      </Card>

      <View style={{ paddingHorizontal: spacing.xs }}>
        <AppText variant="caption">
          Customer payments for physical ready-mix concrete orders are handled separately
          after the supplying plant confirms the order and the customer accepts its terms.
        </AppText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.md, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: 72,
    textAlignVertical: "top",
    fontSize: fontSize.sm,
  },
  banner: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
});
