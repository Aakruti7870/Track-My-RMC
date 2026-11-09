import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { storage } from "@/src/utils/storage";
import {
  configureForegroundNotifications,
  getLastNotificationRoute,
  getNotificationPermissionStatus,
  registerPushDevice,
  subscribeToNotificationResponses,
  subscribeToPushTokenChanges,
} from "@/src/notifications/pushClient";

// The former second login-time notification-consent modal is removed.
// PermissionProvider owns the single app-wide post-login card flow, including
// Google Play reviewer accounts. This bridge never requests an OS permission;
// it only registers a token after explicit stored opt-in AND an Android grant.
export function PushNotificationBridge() {
  const { token, user } = useAuth();
  const router = useRouter();
  const coldStartHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "android" || !token || !user) return;
    let disposed = false;
    let removeTokenListener: () => void = () => {};

    void (async () => {
      await configureForegroundNotifications();
      const permission = await getNotificationPermissionStatus();
      const raw = await storage.getItem(
        `tmrmc_post_login_permission_cards_v2:${user.id}:${user.role}`,
        "",
      );
      let optedIn = false;
      if (typeof raw === "string" && raw) {
        try {
          const preference = JSON.parse(raw) as {
            version?: number;
            completed?: boolean;
            choices?: { notifications?: string };
          };
          optedIn = preference.version === 2 && preference.completed === true &&
            preference.choices?.notifications === "granted";
        } catch { /* No reliable consent on this device. */ }
      }
      if (permission === "granted" && optedIn && !disposed) {
        await registerPushDevice(token, false);
      }

      const remove = await subscribeToPushTokenChanges(token);
      if (disposed) remove();
      else removeTokenListener = remove;
    })().catch(() => undefined);

    return () => {
      disposed = true;
      removeTokenListener();
    };
  }, [token, user?.id]);

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

  return null;
}
