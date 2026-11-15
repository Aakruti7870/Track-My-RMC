import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiErrorDetail, apiPost } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { formatAccountMobile } from "@/src/auth/phone";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast } from "@/src/components/ui/Toast";
import { useGet } from "@/src/hooks/useApi";
import { AppText } from "@/src/components/ui/AppText";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { control, radius, spacing } from "@/src/theme/tokens";
import { markKycReturnPending, saveKycDestination, takeKycDestination } from "@/src/kyc/returnContext";

const STATE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; tone: "success" | "warning" | "error" | "info" }> = {
  VERIFIED: { icon: "shield-checkmark", title: "KYC verified", body: "You can now place concrete orders.", tone: "success" },
  IN_PROGRESS: { icon: "phone-portrait-outline", title: "Verification in progress", body: "If you have shared Aadhaar in DigiLocker, check verification here.", tone: "warning" },
  PENDING: { icon: "hourglass-outline", title: "Confirmation pending", body: "TrackMyRMC is checking your DigiLocker verification.", tone: "warning" },
  REJECTED: { icon: "close-circle", title: "Verification rejected", body: "Contact support if you need help before trying again.", tone: "error" },
  REVIEW_NEEDED: { icon: "alert-circle-outline", title: "Identity details need attention", body: "Check that DigiLocker contains your own identity details, or contact support.", tone: "warning" },
  MOBILE_MISMATCH: { icon: "call-outline", title: "Mobile numbers differ", body: "Automatic KYC requires the mobile in your DigiLocker profile to match your TrackMyRMC login mobile. If you use different numbers, contact support before retrying.", tone: "warning" },
  PROFILE_INCOMPLETE: { icon: "person-outline", title: "DigiLocker profile incomplete", body: "DigiLocker could not confirm your name, mobile or Aadhaar. Check your DigiLocker profile or contact support.", tone: "warning" },
  DOCUMENT_NOT_SHARED: { icon: "document-text-outline", title: "Aadhaar sharing required", body: "Start DigiLocker again and allow Aadhaar sharing to continue.", tone: "warning" },
  DOCUMENT_UNAVAILABLE: { icon: "cloud-offline-outline", title: "DigiLocker document unavailable", body: "DigiLocker could not share your Aadhaar with TrackMyRMC. Try again later or contact support.", tone: "warning" },
  REQUIRES_REVERIFICATION: { icon: "refresh", title: "Start verification again", body: "Open a new DigiLocker session to continue.", tone: "warning" },
  NOT_STARTED: { icon: "id-card-outline", title: "Verify your identity", body: "Use a DigiLocker profile with the same mobile as your TrackMyRMC account and allow Aadhaar sharing to enable live ordering.", tone: "info" },
};

type KycStatusResponse = {
  status: string;
  provider?: string;
  refresh_failed?: boolean;
  retry_after_seconds?: number;
};

export default function KycScreen() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const { returned, draftId, origin } = useLocalSearchParams<{ returned?: string; draftId?: string; origin?: string }>();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { hydrating, token, user, refreshMe } = useAuth();
  const { data, loading, error, refetch } = useGet<KycStatusResponse>(
    user?.role === "customer" ? "/customer/kyc" : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const starting = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(AppState.currentState !== "background");
  const pollAttempts = useRef(0);
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
    if (!confirming) pollAttempts.current = 0;
    if (!token || !active || !confirming || data?.provider === "unavailable") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled || pollAttempts.current++ >= 30) return;
      await refetch();
      // Provider evidence can lag behind the browser return. Failed reads
      // back off rather than causing a burst of provider requests and 429s.
      const delay = data?.refresh_failed ? Math.max(8000, (data.retry_after_seconds ?? 8) * 1000) : 3500;
      if (!cancelled) timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, 800);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [token, active, data?.status, data?.provider, data?.refresh_failed, data?.retry_after_seconds, returningFromProvider, refetch]);

  // Refresh /me until the actual authenticated profile contains both the
  // effective VERIFIED status and a verified name. AuthContext intentionally
  // suppresses transient refresh errors, so promise settlement is not proof.
  // Cap retries to avoid an endless loop when the profile cannot be loaded.
  const profileRefreshAttempts = useRef(0);
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
        // Retry profile synchronization before navigating.
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
  const navigating = useRef(false);
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

  const accountStatus = user?.kyc_status || "NOT_STARTED";
  const lastStatus = accountStatus === "NOT_STARTED" ? user?.kyc_attempt_status || accountStatus : accountStatus;
  const status = data?.status || lastStatus;
  const providerUnavailable = data?.provider === "unavailable" && status !== "VERIFIED";
  const meta = providerUnavailable
    ? { ...STATE_META.PROFILE_INCOMPLETE, title: "DigiLocker unavailable", body: "Try checking again in a few minutes." }
    : STATE_META[status] || STATE_META.NOT_STARTED;
  const mobile = formatAccountMobile(user?.phone || user?.mobile);
  const tone = { success: colors.success, warning: colors.warning, error: colors.error, info: colors.brand }[meta.tone];

  const startKyc = async () => {
    if (!token || providerUnavailable) return;
    if (!user || user.role !== "customer" || starting.current) return;
    starting.current = true;
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
      pollAttempts.current = 0;
      setReturningFromProvider(true);
      await Linking.openURL(result.authorization_url);
    } catch (error: unknown) {
      toast(apiErrorDetail(error, "Could not open DigiLocker"), "error");
      void refetch();
    } finally {
      starting.current = false;
      setSubmitting(false);
    }
  };

  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      pollAttempts.current = 0;
      await refetch();
      if (status === "VERIFIED") await refreshMe();
    } finally {
      setRefreshing(false);
    }
  };

  // Direct links and provider returns may have no back-stack entry.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/customer");
  };

  const checking = status === "PENDING" || status === "IN_PROGRESS" || Boolean(error);
  const showSupportLink = status === "PROFILE_INCOMPLETE" || status === "REVIEW_NEEDED" || status === "REJECTED";
  const action = (() => {
    if (providerUnavailable) {
      return { id: "kyc-refresh-availability", label: "Check DigiLocker Availability", run: refreshStatus };
    }
    if (status === "VERIFIED" && profileSynced && !error) {
      const fromProfile = origin === "profile";
      return {
        id: "kyc-cta",
        label: fromProfile ? "Back to profile" : "Back to Home",
        run: () => router.replace(fromProfile ? "/customer/more" : "/customer"),
      };
    }
    if (checking || status === "VERIFIED") {
      return { id: "kyc-cta", label: "Check verification", run: refreshStatus };
    }
    if (status === "MOBILE_MISMATCH") {
      return { id: "kyc-cta", label: "Contact support", run: () => router.push("/support") };
    }
    return { id: "kyc-cta", label: status === "NOT_STARTED" ? "Continue with DigiLocker" : "Retry DigiLocker", run: startKyc };
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ height: insets.top }} />
      <View style={[styles.header, { borderBottomColor: colors.divider }]}>
        <Pressable testID="kyc-back" accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={[styles.iconBtn, { borderColor: colors.border }]}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <AppText variant="sectionTitle" style={{ flexShrink: 1 }}>KYC Verification</AppText>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        {loading && !data ? (
          <Skeleton height={200} style={{ borderRadius: radius.lg }} />
        ) : (
          <>
            <Card testID={providerUnavailable ? "kyc-unavailable" : "kyc-status"} style={{ gap: spacing.md, paddingVertical: spacing.xl, borderColor: tone + "66" }}>
              <View style={[styles.statusIcon, { backgroundColor: tone, alignSelf: "center" }]}>
                <Ionicons name={meta.icon} size={34} color={scheme === "dark" ? "#121212" : "#FFFFFF"} />
              </View>
              <AppText variant="heading" center>{meta.title}</AppText>
              <AppText variant="bodyMuted" center>{meta.body}</AppText>
              {mobile && status !== "VERIFIED" ? (
                <AppText variant="caption" center testID="kyc-login-mobile">{`TrackMyRMC login mobile · ${mobile}`}</AppText>
              ) : null}
              {data?.refresh_failed || error ? (
                <AppText variant="caption" center color={colors.warning}>
                  {error || "Confirmation is temporarily unavailable. Check verification again shortly."}
                </AppText>
              ) : null}
            </Card>

            <Button testID={action.id} label={action.label} onPress={action.run} loading={submitting || refreshing} />
            {!providerUnavailable && status === "IN_PROGRESS" ? (
              <Button testID="kyc-restart" label="Start a new DigiLocker session" variant="outline" onPress={startKyc} loading={submitting} />
            ) : null}
            {status === "MOBILE_MISMATCH" && !providerUnavailable && !error ? (
              <Button label="Retry DigiLocker" variant="outline" onPress={startKyc} loading={submitting} />
            ) : null}
            {showSupportLink ? (
              <Button label="Contact support" variant="outline" onPress={() => router.push("/support")} />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: control.minTouch, height: control.minTouch, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  statusIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
});
