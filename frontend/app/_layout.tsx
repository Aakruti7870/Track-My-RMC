import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { getThemedSceneStyle } from "@/src/theme/sceneBackground";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts } from "expo-font";

// Registers the background location task at JS module scope before any screen
// mounts. TaskManager requires this for Android background execution.
import "@/src/location/tripTracking";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ThemeProvider, useTheme } from "@/src/theme/ThemeProvider";
import { AuthProvider } from "@/src/auth/AuthContext";
import { ToastProvider } from "@/src/components/ui/Toast";
import { PushNotificationBridge } from "@/src/notifications/PushNotificationBridge";
import { BackgroundLocationConsentProvider } from "@/src/location/BackgroundLocationConsent";
import { SupportWidgetBridge } from "@/src/support/SupportWidgetBridge";
import { PermissionProvider } from "@/src/permissions/PermissionProvider";
import { RootBackHandler } from "@/src/navigation/RootBackHandler";

// Keep the native splash visible from cold start until fonts, theme preference,
// and the branded opening artwork are ready. Development warnings remain enabled.
void SplashScreen.preventAutoHideAsync();

// One image per navigation tree, not one image per screen or glass card.
function ThemedNavigator() {
  const { colors } = useTheme();
  return (
    <View style={[styles.appCanvas, { backgroundColor: colors.isDark ? "#0E1116" : "#F7F8F9" }]}>
      {/* Opaque route scenes prevent a previously visited page from bleeding through. */}
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: getThemedSceneStyle(colors) }} />
    </View>
  );
}

// Native Android/iOS startup stays a PNG; after app hydration the bundled MP4
// plays once above the existing router and login screen. No permissions or network
// are required for playback. A timeout prevents startup from getting stuck.
function OpeningSplashVideo({
  active,
  reduceMotion,
  onFinish,
}: {
  active: boolean;
  reduceMotion: boolean;
  onFinish: () => void;
}) {
  const player = useVideoPlayer(require("../assets/images/TrackMyRMC_Splash_screen.mp4"), (video) => {
    video.loop = false;
    video.muted = true;
  });
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onFinish();
  }, [onFinish]);

  useEffect(() => {
    const ended = player.addListener("playToEnd", finish);
    const status = player.addListener("statusChange", ({ status }) => {
      if (status === "error") finish();
    });
    return () => {
      ended.remove();
      status.remove();
    };
  }, [player, finish]);

  useEffect(() => {
    if (!active) return;
    if (reduceMotion) {
      finish();
      return;
    }
    const fallback = setTimeout(finish, 4200);
    try {
      player.play();
    } catch {
      finish();
    }
    return () => clearTimeout(fallback);
  }, [active, reduceMotion, player, finish]);

  return (
    <View style={styles.openingSplash} pointerEvents="auto" testID="opening-splash-video">
      <VideoView
        style={styles.openingVideo}
        player={player}
        contentFit="contain"
        nativeControls={false}
      />
    </View>
  );
}

export default function RootLayout() {
  const [themeReady, setThemeReady] = useState(false);
  const [showOpeningArtwork, setShowOpeningArtwork] = useState(true);
  const [nativeSplashHidden, setNativeSplashHidden] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [iconsLoaded, iconError] = useIconFonts();
  const [fontsLoaded, fontError] = useFonts({
    "Outfit-SemiBold": require("../assets/fonts/Outfit-SemiBold.ttf"),
    "Outfit-Bold": require("../assets/fonts/Outfit-Bold.ttf"),
    "Jakarta-Regular": require("../assets/fonts/Jakarta-Regular.ttf"),
    "Jakarta-Medium": require("../assets/fonts/Jakarta-Medium.ttf"),
    "Jakarta-SemiBold": require("../assets/fonts/Jakarta-SemiBold.ttf"),
    "Jakarta-Bold": require("../assets/fonts/Jakarta-Bold.ttf"),
  });

  const iconsReady = iconsLoaded || !!iconError;
  const fontsReady = fontsLoaded || !!fontError;
  const handleThemeReady = useCallback(() => setThemeReady(true), []);
  const appReady = iconsReady && fontsReady && themeReady;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (mounted) setReduceMotion(enabled); })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!appReady) return;
    let mounted = true;
    // The video is mounted before hiding the native launch splash to avoid a blank frame.
    void SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => { if (mounted) setNativeSplashHidden(true); });
    return () => { mounted = false; };
  }, [appReady]);

  const finishOpening = useCallback(() => setShowOpeningArtwork(false), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {iconsReady && fontsReady ? (
        <SafeAreaProvider>
          <KeyboardProvider>
            <ThemeProvider onReady={handleThemeReady}>
              <AuthProvider>
                <ToastProvider>
                  <PushNotificationBridge />
                  <BackgroundLocationConsentProvider />
                  <PermissionProvider>
                  <RootBackHandler />
                  <ThemedNavigator />
                  <SupportWidgetBridge />
                  </PermissionProvider>
                </ToastProvider>
              </AuthProvider>
            </ThemeProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      ) : null}
      {showOpeningArtwork && appReady ? (
        <OpeningSplashVideo
          active={nativeSplashHidden}
          reduceMotion={reduceMotion}
          onFinish={finishOpening}
        />
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  appCanvas: { flex: 1 },
  openingSplash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#101112",
  },
  openingVideo: {
    ...StyleSheet.absoluteFillObject,
  },
});
