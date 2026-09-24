import { useEffect, useRef, useState } from "react";
import { Modal, Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";
import { storage } from "@/src/utils/storage";
import {
  configureForegroundNotifications,
  getLastNotificationRoute,
  getNotificationPermissionStatus,
  registerPushDevice,
  subscribeToNotificationResponses,
  subscribeToPushTokenChanges,
} from "@/src/notifications/pushClient";

const CONSENT_KEY_PREFIX = "tmrmc_notification_consent_v1:";

export function PushNotificationBridge() {
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const coldStartHandled = useRef(false);
  const [consentVisible, setConsentVisible] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);

  const consentKey = user?.id ? `${CONSENT_KEY_PREFIX}${user.id}` : null;

  useEffect(() => {
    if (Platform.OS !== "android" || !token || !user || !consentKey) return;
    let disposed = false;
    let removeTokenListener: () => void = () => {};

    void (async () => {
      await configureForegroundNotifications();
      const permission = await getNotificationPermissionStatus();
      if (permission === "granted") {
        await registerPushDevice(token, false);
      } else {
        const choice = await storage.getItem<string>(consentKey, "");
        if (!disposed && !choice) setConsentVisible(true);
      }

      const remove = await subscribeToPushTokenChanges(token);
      if (disposed) remove();
      else removeTokenListener = remove;
    })().catch(() => undefined);

    return () => {
      disposed = true;
      removeTokenListener();
    };
  }, [consentKey, token, user]);

  useEffect(() => {
    if (Platform.OS !== "android" || !token) return;
    let disposed = false;
    let removeResponseListener: () => void = () => {};
    const openRoute = (route: string) => {
      if (!disposed) router.push(route as never);
    };

    void (async () => {
      const remove = await subscribeToNotificationResponses(openRoute);
      if (disposed) {
        remove();
        return;
      }
      removeResponseListener = remove;
      if (!coldStartHandled.current) {
        coldStartHandled.current = true;
        const route = await getLastNotificationRoute();
        if (route) openRoute(route);
      }
    })().catch(() => undefined);

    return () => {
      disposed = true;
      removeResponseListener();
    };
  }, [router, token]);

  const enableNotifications = async () => {
    if (!token || !consentKey) return;
    setConsentBusy(true);
    try {
      const registered = await registerPushDevice(token, true);
      await storage.setItem(consentKey, registered ? "enabled" : "declined-system");
      setConsentVisible(false);
    } finally {
      setConsentBusy(false);
    }
  };

  const declineNotifications = async () => {
    if (consentKey) await storage.setItem(consentKey, "not-now");
    setConsentVisible(false);
  };

  if (Platform.OS !== "android") return null;

  return (
    <Modal visible={consentVisible} transparent animationType="fade" onRequestClose={declineNotifications}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
            <Ionicons name="notifications-outline" size={26} color={colors.onBrandSoft} />
          </View>
          <AppText variant="title">Stay updated on your work</AppText>
          <AppText variant="bodyMuted">
            TrackMyRMC can send notifications for order approvals, dispatch and delivery updates, assigned trips, KYC decisions and safety alerts relevant to your account.
          </AppText>
          <AppText variant="caption">
            Notifications are optional. Choosing Not now does not block any app feature; updates remain available inside TrackMyRMC.
          </AppText>
          <Button label="Enable notifications" onPress={enableNotifications} loading={consentBusy} />
          <Button label="Not now" variant="outline" onPress={declineNotifications} disabled={consentBusy} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.md,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
});