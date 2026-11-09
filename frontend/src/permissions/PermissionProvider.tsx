import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { apiGet, apiPut } from "@/src/api/client";
import { ThemedScreen } from "@/src/components/ThemedScreen";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { registerPushDevice, unregisterPushDevice } from "@/src/notifications/pushClient";
import { saveNotificationConsent } from "@/src/notifications/notificationConsent";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";
import { storage } from "@/src/utils/storage";

// Keep existing customer discovery preferences and purpose-specific disclosures.
// This versioned, account-scoped welcome replaces the duplicate general
// notification modal. It never grants an OS permission or enables tracking by
// itself. Driver background location still requires the prominent disclosure
// shown when an active trip begins.
const VERSION = 1;
const INTRO_VERSION = 2;
const INTRO_KEY_PREFIX = "tmrmc_post_login_permission_cards_v2:";
type Choice = "granted" | "denied" | "manual" | "unavailable" | "undetermined";
type Decision = { version: number; location_choice: Choice; notification_choice: Choice };
type PermissionKind = "location" | "camera" | "notifications";
type IntroDecision = "granted" | "denied" | "skipped";

type PermissionContext = {
  ready: boolean;
  locationEnabled: boolean;
  enableDiscoveryLocation: () => Promise<void>;
  review: () => void;
};

const Permissions = createContext<PermissionContext>({
  ready: true,
  locationEnabled: false,
  enableDiscoveryLocation: async () => undefined,
  review: () => undefined,
});
export const usePermissions = () => useContext(Permissions);

function stepsForRole(role: string): PermissionKind[] {
  // Only the Driver uses camera capture for POD. A Location request on the
  // welcome screen is foreground-only; background access is never asked here.
  return role === "driver"
    ? ["location", "camera", "notifications"]
    : ["location", "notifications"];
}

async function isForegroundLocationGranted(): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      if (typeof navigator === "undefined" || !navigator.permissions) return false;
      return (await navigator.permissions.query({ name: "geolocation" })).state === "granted";
    }
    return (await Location.getForegroundPermissionsAsync()).status === "granted";
  } catch {
    return false;
  }
}

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const { token, user, hydrating } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const account = user?.role === "customer" ? user.id : null;
  const [locationPreference, setLocationPreference] = useState(false);
  const [runtimeGranted, setRuntimeGranted] = useState(false);
  const [notificationChoice, setNotificationChoice] = useState<Choice>("manual");
  const newlyApprovedAccount = useRef<string | null>(null);
  const newlyDeclinedAccount = useRef<string | null>(null);

  // Reviewer accounts use this exact gate after their dedicated OTP flow.
  // Central Admin / Authority remain web-only and never enter a mobile role.
  const introIdentity = Platform.OS === "android" && !hydrating && token && user &&
    user.role !== "central_admin" && user.role !== "authority"
    ? `${user.id}:${user.role}`
    : null;
  const introIdentityRef = useRef(introIdentity);
  introIdentityRef.current = introIdentity;
  const [introFor, setIntroFor] = useState<string | null>(null);
  const [introStep, setIntroStep] = useState(0);
  const [introBusy, setIntroBusy] = useState(false);
  const [introError, setIntroError] = useState<string | null>(null);
  const introChoices = useRef<Partial<Record<PermissionKind, IntroDecision>>>({});
  const introActionInFlight = useRef(false);
  const steps = user ? stepsForRole(user.role) : [];
  const introVisible = Boolean(introIdentity && introFor === introIdentity);
  const currentKind = introVisible ? steps[introStep] : undefined;

  const refreshLocation = useCallback(async () => {
    setRuntimeGranted(await isForegroundLocationGranted());
  }, []);

  // Read a completed choice per account and role. No permission prompt is
  // triggered by a screen render, rehydration, or switching between role tabs.
  useEffect(() => {
    let active = true;
    setIntroFor(null);
    setIntroStep(0);
    setIntroError(null);
    introChoices.current = {};
    introActionInFlight.current = false;
    if (!introIdentity) return () => { active = false; };
    void (async () => {
      const raw = await storage.getItem(`${INTRO_KEY_PREFIX}${introIdentity}`, "");
      let completed = false;
      if (typeof raw === "string" && raw) {
        try {
          const parsed = JSON.parse(raw) as { version?: number; completed?: boolean };
          completed = parsed.version === INTRO_VERSION && parsed.completed === true;
        } catch { /* Legacy or corrupt state: show the new disclosure. */ }
      }
      if (active && !completed) setIntroFor(introIdentity);
    })();
    return () => { active = false; };
  }, [introIdentity]);

  // Existing customer discovery consent is independent from the welcome.
  // An OS grant by itself never opts the customer in to automatic discovery.
  useEffect(() => {
    setLocationPreference(false);
    setRuntimeGranted(false);
    setNotificationChoice("manual");
    if (newlyApprovedAccount.current !== account) newlyApprovedAccount.current = null;
    if (newlyDeclinedAccount.current !== account) newlyDeclinedAccount.current = null;
    if (!account || !token) return;
    let cancelled = false;
    void (async () => {
      let decision: Decision | null = null;
      const saved = await storage.getItem(`permission-user-${account}`, "");
      let local: Decision | null = null;
      try { local = saved ? JSON.parse(saved) as Decision : null; }
      catch { /* No saved choice. */ }
      try {
        decision = (await apiGet<{ consent: Decision | null }>("/me/permission-consent", token)).consent;
      } catch { /* Offline: use last local choice. */ }
      if (cancelled) return;
      const denied = local?.location_choice === "denied" || decision?.location_choice === "denied";
      const approved = newlyApprovedAccount.current === account ||
        decision?.location_choice === "granted" || local?.location_choice === "granted";
      // A choice made while hydration was pending wins over its stale snapshot.
      setLocationPreference(newlyDeclinedAccount.current !== account &&
        (newlyApprovedAccount.current === account || (!denied && approved)));
      setNotificationChoice(local?.notification_choice ?? decision?.notification_choice ?? "manual");
      await refreshLocation();
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [account, token, refreshLocation]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refreshLocation();
    });
    return () => subscription.remove();
  }, [refreshLocation]);

  const enableDiscoveryLocation = async () => {
    // Explicit user action AND real Android grant are required.
    const granted = await isForegroundLocationGranted();
    setRuntimeGranted(granted);
    if (!granted) return;
    if (account) {
      newlyApprovedAccount.current = account;
      newlyDeclinedAccount.current = null;
    }
    setLocationPreference(true);
    if (!account || !token || locationPreference) return;
    const decision: Decision = {
      version: VERSION,
      location_choice: "granted",
      notification_choice: notificationChoice,
    };
    try {
      await apiPut("/me/permission-consent", token, decision);
      await storage.setItem(`permission-user-${account}`, JSON.stringify(decision));
    } catch {
      await storage.setItem(`permission-user-${account}`, JSON.stringify(decision));
    }
  };

  const advance = async (kind: PermissionKind, result: IntroDecision, identity: string | null) => {
    if (!identity || introIdentityRef.current !== identity) return;
    const nextChoices = { ...introChoices.current, [kind]: result };
    introChoices.current = nextChoices;
    setIntroError(null);
    if (kind === "location" && account && token && result !== "granted") {
      // A newer Not now decision must cancel an older Nearby Plants opt-in,
      // even when Android still holds a previously granted location permission.
      newlyApprovedAccount.current = null;
      newlyDeclinedAccount.current = account;
      setLocationPreference(false);
      const decision: Decision = {
        version: VERSION,
        location_choice: "denied",
        notification_choice: notificationChoice,
      };
      await storage.setItem(`permission-user-${account}`, JSON.stringify(decision));
      await apiPut("/me/permission-consent", token, decision).catch(() => undefined);
    }
    if (kind === "notifications") {
      // Persist opt-out before awaiting network revocation so token rotations
      // cannot restore a registration while that request is in flight.
      await saveNotificationConsent(identity, result);
    }
    if (kind === "notifications" && account && token) {
      const decision: Decision = {
        version: VERSION,
        location_choice: nextChoices.location === "granted" ? "granted" : "denied",
        notification_choice: result === "granted" ? "granted" : "denied",
      };
      setNotificationChoice(decision.notification_choice);
      await storage.setItem(`permission-user-${account}`, JSON.stringify(decision));
      await apiPut("/me/permission-consent", token, decision).catch(() => undefined);
    }
    if (kind === "notifications" && result !== "granted" && token) {
      // "Not now" overrides previously registered device tokens as well.
      await unregisterPushDevice(token).catch(() => undefined);
    }
    if (introStep < steps.length - 1) {
      setIntroStep(step => step + 1);
      return;
    }
    // Record the user's decisions, not an assumed Android permission grant.
    // Future feature access must re-check the OS status on each use.
    await storage.setItem(`${INTRO_KEY_PREFIX}${identity}`, JSON.stringify({
      version: INTRO_VERSION,
      completed: true,
      choices: nextChoices,
      completedAt: new Date().toISOString(),
    }));
    if (introIdentityRef.current === identity) setIntroFor(null);
  };

  const declineCurrent = async () => {
    const kind = currentKind;
    const identity = introIdentity;
    if (!kind || !identity || introActionInFlight.current) return;
    introActionInFlight.current = true;
    setIntroBusy(true);
    try {
      await advance(kind, "skipped", identity);
    } catch {
      setIntroError("Your choice could not be saved. Please try again.");
    } finally {
      introActionInFlight.current = false;
      setIntroBusy(false);
    }
  };

  const allowCurrent = async () => {
    const kind = currentKind;
    const identity = introIdentity;
    if (!kind || !identity || introActionInFlight.current) return;
    introActionInFlight.current = true;
    setIntroBusy(true);
    setIntroError(null);
    try {
      let granted = false;
      if (kind === "location") {
        const current = await Location.getForegroundPermissionsAsync();
        const permission = current.granted || !current.canAskAgain
          ? current : await Location.requestForegroundPermissionsAsync();
        granted = permission.granted;
        if (introIdentityRef.current !== identity) return;
        if (granted && user?.role === "customer") await enableDiscoveryLocation();
      } else if (kind === "camera") {
        const current = await ImagePicker.getCameraPermissionsAsync();
        const permission = current.granted || !current.canAskAgain
          ? current : await ImagePicker.requestCameraPermissionsAsync();
        granted = permission.granted;
      } else {
        const Notifications = await import("expo-notifications");
        const current = await Notifications.getPermissionsAsync();
        const permission = current.granted || !current.canAskAgain
          ? current : await Notifications.requestPermissionsAsync();
        granted = permission.granted;
        if (introIdentityRef.current !== identity) return;
        if (granted && token) {
          // A device-token upload failure must not reinterpret OS consent.
          await registerPushDevice(token, false).catch(() => null);
        }
      }
      await advance(kind, granted ? "granted" : "denied", identity);
    } catch {
      setIntroError("Permission could not be updated. Try again or choose Not now.");
    } finally {
      introActionInFlight.current = false;
      setIntroBusy(false);
    }
  };

  const introContent = currentKind === "location" ? {
    icon: "location-outline" as const,
    title: "Allow your location",
    description: user?.role === "customer"
      ? "Use your location while the app is open to find nearby RMC plants. You can also search by city without location."
      : user?.role === "driver"
        ? "Use location during assigned deliveries to support live mixer tracking and ETA. Background tracking is requested separately, only for an active trip."
        : "Use your location only when you choose a plant/site, attendance, or field-visit feature. No background tracking is requested here.",
    button: "Allow location",
  } : currentKind === "camera" ? {
    icon: "camera-outline" as const,
    title: "Allow your camera",
    description: "Capture a proof-of-delivery site photo when you choose Camera. Existing photos use Android's system photo picker without storage access.",
    button: "Allow camera",
  } : {
    icon: "notifications-outline" as const,
    title: "Allow notifications",
    description: "Receive optional order, dispatch, trip and safety alerts. You can still read updates in the app when notifications are off.",
    button: "Allow notifications",
  };

  return (
    <Permissions.Provider value={{
      ready: !hydrating,
      locationEnabled: locationPreference && runtimeGranted,
      enableDiscoveryLocation,
      review: () => router.push("/permission-settings"),
    }}>
      {children}
      {Platform.OS === "android" ? (
        <Modal
          visible={introVisible}
          animationType="fade"
          presentationStyle="fullScreen"
          onRequestClose={() => { void declineCurrent(); }}
        >
          <ThemedScreen>
            <View testID="post-login-permission-gate" style={[styles.shell, {
              paddingTop: insets.top + spacing.xl,
              paddingBottom: insets.bottom + spacing.lg,
            }]}>
              <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.heading}>
                  <View style={[styles.topIcon, { backgroundColor: colors.brandSoft }]}>
                    <Ionicons name="shield-checkmark-outline" size={24} color={colors.brand} />
                  </View>
                  <AppText variant="eyebrow" center>TrackMyRMC</AppText>
                  <AppText variant="sectionTitle" center>App permissions</AppText>
                  <AppText variant="bodyMuted" center>
                    Choose what to allow. Optional access can be changed later in App permissions.
                  </AppText>
                </View>
                <View style={styles.steps}>
                  {steps.map((kind, index) => (
                    <View key={kind} style={[styles.stepDot, {
                      backgroundColor: index === introStep ? colors.brand : colors.borderStrong,
                      width: index === introStep ? 24 : 8,
                    }]} />
                  ))}
                </View>
                <Card testID="post-login-permission-card" style={styles.consentCard} variant="elevated">
                  <View style={[styles.symbolPlate, {
                    borderColor: colors.brand + "55",
                    backgroundColor: colors.brandSoft,
                  }]}>
                    <Ionicons name={introContent.icon} size={44} color={colors.brand} />
                  </View>
                  <AppText variant="heading" center>{introContent.title}</AppText>
                  <AppText variant="bodyMuted" center style={styles.description}>
                    {introContent.description}
                  </AppText>
                  {introError ? (
                    <AppText variant="caption" color={colors.error} center>{introError}</AppText>
                  ) : null}
                  <View style={styles.actions}>
                    <Button
                      testID="post-login-permission-allow"
                      label={introContent.button}
                      onPress={() => { void allowCurrent(); }}
                      loading={introBusy}
                    />
                    <Button
                      testID="post-login-permission-not-now"
                      label="Not now"
                      variant="ghost"
                      disabled={introBusy}
                      onPress={() => { void declineCurrent(); }}
                    />
                  </View>
                </Card>
                <AppText variant="caption" center style={styles.footnote}>
                  {currentKind === "location" && user?.role === "driver"
                    ? "Background location is never requested during sign-in. An active trip has a separate prominent disclosure."
                    : "Android controls the actual permission decision. Choosing Not now does not block sign-in."}
                </AppText>
              </ScrollView>
            </View>
          </ThemedScreen>
        </Modal>
      ) : null}
    </Permissions.Provider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  scrollContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  heading: { alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  topIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  steps: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, alignItems: "center" },
  stepDot: { height: 8, borderRadius: 8 },
  consentCard: {
    width: "100%",
    alignSelf: "center",
    alignItems: "center",
    minHeight: 318,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  symbolPlate: {
    width: 86,
    height: 86,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  description: { minHeight: 60 },
  actions: { width: "100%", gap: spacing.xs, marginTop: spacing.sm },
  footnote: { paddingHorizontal: spacing.md },
});
