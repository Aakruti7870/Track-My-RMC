import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import {
  configureForegroundNotifications,
  getLastNotificationRoute,
  getNotificationPermissionStatus,
  registerPushDevice,
  subscribeToNotificationResponses,
  subscribeToPushTokenChanges,
} from "@/src/notifications/pushClient";

/**
 * Only registers push tokens for an OS-granted permission. The versioned,
 * authenticated PermissionProvider owns the single "Enable notifications" /
 * "Not now" introduction. No second overlapping post-login modal or
 * unsolicited OS permission dialog from this bridge.
 */
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
      if (permission === "granted") await registerPushDevice(token, false);
      const remove = await subscribeToPushTokenChanges(token);
      if (disposed) remove();
      else removeTokenListener = remove;
    })().catch(() => undefined);
    return () => {
      disposed = true;
      removeTokenListener();
    };
  }, [token, user]);

  useEffect(() => {
    if (Platform.OS !== "android" || !token) return;
    let disposed = false;
    let removeResponseListener: () => void = () => {};
    const openRoute = (route: string) => { if (!disposed) router.push(route as never); };
    void (async () => {
      const remove = await subscribeToNotificationResponses(openRoute);
      if (disposed) { remove(); return; }
      removeResponseListener = remove;
      if (!coldStartHandled.current) {
        coldStartHandled.current = true;
        const route = await getLastNotificationRoute();
        if (route) openRoute(route);
      }
    })().catch(() => undefined);
    return () => { disposed = true; removeResponseListener(); };
  }, [router, token]);

  return null;
}
