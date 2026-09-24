import Constants from "expo-constants";
import { Platform } from "react-native";

import { apiPost } from "@/src/api/client";

const CHANNEL_ID = "default";
let foregroundHandlerConfigured = false;

async function notificationsModule() {
  return import("expo-notifications");
}

function nativeTokenString(data: unknown): string | null {
  if (typeof data === "string") return data.trim() || null;
  if (data == null) return null;
  try {
    const value = JSON.stringify(data);
    return value && value !== "{}" ? value : null;
  } catch {
    return null;
  }
}

async function registerTokenValue(authToken: string, data: unknown): Promise<string | null> {
  const token = nativeTokenString(data);
  if (!token) return null;
  await apiPost("/notifications/device/register", authToken, {
    token,
    platform: "android",
    app_version: Constants.expoConfig?.version ?? null,
  });
  return token;
}

export async function configureForegroundNotifications(): Promise<void> {
  if (Platform.OS !== "android" || foregroundHandlerConfigured) return;
  const Notifications = await notificationsModule();
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  foregroundHandlerConfigured = true;
}

export async function getNotificationPermissionStatus(): Promise<string> {
  if (Platform.OS !== "android") return "granted";
  const Notifications = await notificationsModule();
  const permission = await Notifications.getPermissionsAsync();
  return permission.status;
}

export async function registerPushDevice(
  authToken: string,
  requestPermission = false,
): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  const Notifications = await notificationsModule();
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "TrackMyRMC",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
  });

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted" && requestPermission) {
    // The caller must show TrackMyRMC's app-owned notification explanation and
    // receive an affirmative user action before requesting Android permission.
    permission = await Notifications.requestPermissionsAsync();
  }
  if (permission.status !== "granted") return null;

  const nativeToken = await Notifications.getDevicePushTokenAsync();
  return registerTokenValue(authToken, nativeToken.data);
}

export async function unregisterPushDevice(authToken: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const Notifications = await notificationsModule();
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") return;
  const nativeToken = await Notifications.getDevicePushTokenAsync();
  const token = nativeTokenString(nativeToken.data);
  if (!token) return;
  await apiPost("/notifications/device/unregister", authToken, { token });
}

export async function subscribeToPushTokenChanges(
  authToken: string,
): Promise<() => void> {
  if (Platform.OS !== "android") return () => undefined;
  const Notifications = await notificationsModule();
  const subscription = Notifications.addPushTokenListener((nativeToken) => {
    void registerTokenValue(authToken, nativeToken.data).catch(() => undefined);
  });
  return () => subscription.remove();
}

function routeFromData(data: Record<string, unknown> | undefined): string {
  const route = data?.route;
  return typeof route === "string" && route.startsWith("/") ? route : "/notifications";
}

export async function getLastNotificationRoute(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  const Notifications = await notificationsModule();
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return null;
  return routeFromData(response.notification.request.content.data as Record<string, unknown> | undefined);
}

export async function subscribeToNotificationResponses(
  onRoute: (route: string) => void,
): Promise<() => void> {
  if (Platform.OS !== "android") return () => undefined;
  const Notifications = await notificationsModule();
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    onRoute(routeFromData(response.notification.request.content.data as Record<string, unknown> | undefined));
  });
  return () => subscription.remove();
}