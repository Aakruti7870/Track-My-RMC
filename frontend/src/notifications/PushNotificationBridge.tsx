import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { usePermissions } from "@/src/permissions/PermissionProvider";
import {
  configureForegroundNotifications,
  getLastNotificationRoute,
  getNotificationPermissionStatus,
  registerPushDevice,
  unregisterPushDevice,
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
  const { ready, notificationEnabled } = usePermissions();
  const router = useRouter();
  const coldStartHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "android" || !token || !user || !ready) return;
    let disposed = false;
    let removeTokenListener: () => void = () => {};
    void (async () => {
      await configureForegroundNotifications();
      const permission = await getNotificationPermissionStatus();
      if (!notificationEnabled) {
        // Existing OS permission does not override a user's in-app "Not now".
        if (permission === "granted") await unregisterPushDevice(token);
        return;
      }
      if (permission !== "granted") return;
      await registerPushDevice(token, false);
      const remove = await subscribeToPushTokenChanges(token);
      if (disposed) remove();
      else removeTokenListener = remove;
    })().catch(() => undefined);
    return () => {
      disposed = true;
      removeTokenListener();
    };
  }, [token, user, ready, notificationEnabled]);

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
