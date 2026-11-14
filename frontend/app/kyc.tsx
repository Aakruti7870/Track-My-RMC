import React, { useEffect, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";
import { markKycReturnPending, saveKycDestination, takeKycDestination } from "@/src/kyc/returnContext";

const STATE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; tone: "success" | "warning" | "error" | "info" }> = {
  VERIFIED: { icon: "shield-checkmark", title: "KYC Verified", body: "You can place orders using the app.", tone: "success" },
  IN_PROGRESS: { icon: "phone-portrait-outline", title: "Complete DigiLocker", body: "Finish consent in DigiLocker. If you cancelled or closed it, you can safely restart the verification.", tone: "warning" },
  PENDING: { icon: "hourglass-outline", title: "Confirmation pending", body: "TrackMyRMC is checking the completed identity evidence. You do not need to submit another verification.", tone: "warning" },
  REJECTED: { icon: "close-circle", title: "Verification rejected", body: "Something didn't match. Please retry.", tone: "error" },
  REVIEW_NEEDED: { icon: "alert-circle-outline", title: "Identity details did not match", body: "Your DigiLocker name or mobile did not match this account. Retry, or contact support for help.", tone: "warning" },
  REQUIRES_REVERIFICATION: { icon: "refresh", title: "Re-verification required", body: "Please start DigiLocker again to continue.", tone: "warning" },
  NOT_STARTED: { icon: "id-card-outline", title: "Verify your identity", body: "Complete KYC to unlock live concrete ordering.", tone: "info" },
};

const STEPS = [
  "Verify your identity via DigiLocker / approved KYC",
  "We confirm your details against government records",
  "Successful Live DigiLocker confirmation unlocks ordering automatically",
];

type KycStatusResponse = {
  status: string;
  provider?: string;
  refresh_failed?: boolean;
};

export default function KycScreen() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const { returned, draftId, origin } = useLocalSearchParams<{ returned?: string; draftId?: string; origin?: string }>();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { hydrating, token, user, refreshMe } = useAuth();
  const { data, loading, error, refetch } = useGet<KycStatusResponse>("/customer/kyc");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(AppState.currentState !== "background");
  const [returningFromProvider, setReturningFromProvider] = useState(returned === "1");
  // A resolved refreshMe() promise does not prove /me succeeded: transient
  // failures are handled within AuthContext. Verify the actual profile state.
  const profileSynced = user?.kyc_status?.toUpperCase() === "VERIFIED"
    && Boolean(user?.verified_name?.trim());

  useEffect(() => {
    if (hydrating) return;
    let cancelled = false;
    if (!token || !user) {
      void (async () => {
        if (returned === "1") await markKycReturnPending();
        if (!cancelled) router.replace("/login");
      })();
    } else if (user.role !== "customer") {
      router.replace("/role-home");
    }
    return () => { cancelled = true; };
  }, [hydrating, token, user, returned, router]);

  useEffect(() => {
    if (returned === "1") setReturningFromProvider(true);
  }, [returned]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setActive(next === "active");
      if (next === "active") void refetch();
    });
    return () => subscription.remove();
  }, [refetch]);

  // The callback URL cannot attest identity. Poll this authenticated endpoint
  // after returning to the app, without overlapping requests or endless retries.
  useEffect(() => {
    // A concurrent server-side poll can briefly return PENDING while the
    // successful Live consent is being committed. Keep checking on app return,
    // but limit retries so genuine review-pending Test sessions do not loop.
    const confirming = data?.status === "IN_PROGRESS"
      || (returningFromProvider && data?.status === "PENDING");
    if (!token || !active || !confirming || data?.provider === "unavailable") return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled || attempts++ >= 30) return;
      await refetch();
      if (!cancelled) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 800);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [token, active, data?.status, data?.provider, returningFromProvider, refetch]);

  // Refresh /me until the actual authenticated profile contains both the
  // effective VERIFIED status and a verified name. AuthContext intentionally
  // suppresses transient refresh errors, so promise settlement is not proof.
  // Cap retries to avoid an endless loop when the profile cannot be loaded.
  const profileRefreshAttempts = React.useRef(0);
  useEffect(() => {
    if (data?.status !== "VERIFIED") {
      profileRefreshAttempts.current = 0;
      return;
    }
    if (!token || profileSynced) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const syncProfile = async () => {
      if (cancelled || profileRefreshAttempts.current >= 8) return;
      profileRefreshAttempts.current += 1;
      try {
        await refreshMe();
      } catch {
        // Remain on KYC until an authenticated /me refresh really succeeds.
      }
      if (!cancelled && profileRefreshAttempts.current < 8) {
        timer = setTimeout(() => { void syncProfile(); }, 2500);
      }
    };
    void syncProfile();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [data?.status, token, profileSynced, refreshMe]);

  // Make navigation independent of the timing of the provider-return link:
  // verification and the 'returned' route flag can arrive in either order.
  // Do not open Customer Home before /me reflects the verified identity.
  const navigating = React.useRef(false);
  useEffect(() => {
    if (data?.status !== "VERIFIED" || !profileSynced || !returningFromProvider || !user || navigating.current) return;
    navigating.current = true;
    void (async () => {
      const destination = await takeKycDestination(user.id);
      if (destination.kind === "order" && destination.draftId) {
        router.replace({ pathname: "/new-order", params: { draftId: destination.draftId } });
      } else if (destination.kind === "profile") {
        router.replace("/customer/more");
      } else {
        router.replace("/customer");
      }
    })();
  }, [data?.status, profileSynced, returningFromProvider, user, router]);

  const status = data?.status || "NOT_STARTED";
  const providerUnavailable = data?.provider === "unavailable" && status !== "VERIFIED";
  const meta = STATE_META[status] || STATE_META.NOT_STARTED;
  const tone = { success: colors.success, warning: colors.warning, error: colors.error, info: colors.brand }[meta.tone];

  const startKyc = async () => {
    if (!token || providerUnavailable) return;
    if (!user || user.role !== "customer") return;
    setSubmitting(true);
    try {
      const destination = draftId ? { kind: "order" as const, draftId }
        : origin === "profile" ? { kind: "profile" as const } : { kind: "home" as const };
      if (!(await saveKycDestination(user.id, destination))) {
        throw { detail: "Could not save the return location. Please try again." };
      }
      const result = await apiPost<{ status: string; authorization_url: string }>("/customer/kyc/start", token);
      if (!result.authorization_url?.startsWith("https://")) {
        throw { detail: "DigiLocker did not return a secure authorization link" };
      }
      toast("Opening DigiLocker securely", "success");
      setReturningFromProvider(true);
      await Linking.openURL(result.authorization_url);
    } catch (e: any) {
      toast(e.detail || "Could not start KYC", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const ctaLabel =
    status === "NOT_STARTED"
      ? "Continue with DigiLocker"
      : status === "IN_PROGRESS"
      ? "Restart DigiLocker"
      : status === "PENDING"
      ? "Check Verification"
      : status === "VERIFIED"
      ? "Back to Home"
      : "Retry DigiLocker";

  const onCta =
    status === "VERIFIED"
      ? () => router.back()
      : status === "PENDING"
      ? refreshStatus
      : startKyc;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="kyc-back" onPress={() => router.back()} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="title">KYC Verification</AppText>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        {loading && !data ? (
          <Skeleton height={200} style={{ borderRadius: radius.lg }} />
        ) : (
          <>
            <Card style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl, backgroundColor: tone + "14", borderColor: tone + "44" }}>
              <View style={[styles.statusIcon, { backgroundColor: tone }]}>
                <Ionicons name={meta.icon} size={34} color={scheme === "dark" ? "#121212" : "#FFFFFF"} />
              </View>
              <AppText variant="heading" center>{meta.title}</AppText>
              <AppText variant="bodyMuted" center>{meta.body}</AppText>
              {status === "VERIFIED" ? (
                <View style={[styles.verifiedPill, { backgroundColor: colors.success }]}>
                  <Ionicons name="checkmark-circle" size={16} color="#121212" />
                  <AppText style={{ fontFamily: fonts.bold, fontSize: fontSize.sm, color: "#121212" }}>
                    YOU CAN PLACE ORDERS USING APP
                  </AppText>
                </View>
              ) : null}
            </Card>

            {providerUnavailable ? (
              <Card testID="kyc-unavailable" style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderColor: colors.warning + "66" }}>
                <Ionicons name="information-circle-outline" size={20} color={colors.warning} />
                <AppText variant="caption" style={{ flex: 1 }}>
                  DigiLocker verification is temporarily unavailable. Your existing KYC status is unchanged. You can check again later; do not share identity documents with anyone outside the official verification process.
                </AppText>
              </Card>
            ) : null}

            {data?.refresh_failed ? (
              <Card style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderColor: colors.warning + "66" }}>
                <Ionicons name="warning-outline" size={18} color={colors.warning} />
                <AppText variant="caption" style={{ flex: 1 }}>
                  DigiLocker status could not be refreshed right now. Your KYC is not rejected. You can safely restart DigiLocker.
                </AppText>
              </Card>
            ) : null}

            {status !== "VERIFIED" ? (
              <View style={{ gap: spacing.md }}>
                <AppText variant="heading">How it works</AppText>
                {STEPS.map((s, i) => (
                  <View key={i} style={styles.step}>
                    <View style={[styles.stepNum, { backgroundColor: colors.brandSoft }]}>
                      <AppText style={{ fontFamily: fonts.bold, color: colors.onBrandSoft, fontSize: fontSize.sm }}>{i + 1}</AppText>
                    </View>
                    <AppText variant="body" style={{ flex: 1 }}>{s}</AppText>
                  </View>
                ))}
                <Card style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.onSurfaceTertiary} />
                  <AppText variant="caption" style={{ flex: 1 }}>
                    Your documents are encrypted and used only for verification.
                  </AppText>
                </Card>
              </View>
            ) : null}

            {error ? <AppText variant="caption" color={colors.error}>{error}</AppText> : null}

            {providerUnavailable ? (
              <Button testID="kyc-refresh-availability" label="Check DigiLocker Availability" variant="outline" onPress={refreshStatus} loading={refreshing} />
            ) : (
              <Button testID="kyc-cta" label={ctaLabel} onPress={onCta} loading={submitting || (status === "PENDING" && refreshing)} />
            )}

            {!providerUnavailable && status === "IN_PROGRESS" ? (
              <Button testID="kyc-refresh" label="Refresh Status" variant="outline" onPress={refreshStatus} loading={refreshing} />
            ) : null}
            {status === "REVIEW_NEEDED" ? <Button label="Contact Support" variant="outline" onPress={() => router.push("/support")} /> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  statusIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  verifiedPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepNum: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
