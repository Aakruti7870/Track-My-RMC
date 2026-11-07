import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Image, StyleSheet, View } from "react-native";
import { getThemedSceneStyle } from "@/src/theme/sceneBackground";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts } from "expo-font";

// Register the background location task before any route mounts.
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

// Expo native launch uses the PNG specified in app.json. Keep it visible
// until the fonts, theme and matching React Native artwork are ready.
void SplashScreen.preventAutoHideAsync();

function ThemedNavigator() {
  const { colors } = useTheme();
  return (
    <View style={[styles.appCanvas, { backgroundColor: colors.isDark ? "#0E1116" : "#F7F8F9" }]}>
      {/* Opaque route scenes prevent previous pages from showing behind new pages. */}
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: getThemedSceneStyle(colors) }} />
    </View>
  );
}

export default function RootLayout() {
  const [themeReady, setThemeReady] = useState(false);
  const [artworkLoaded, setArtworkLoaded] = useState(false);
  const [showOpeningArtwork, setShowOpeningArtwork] = useState(true);
  const [iconsLoaded, iconError] = useIconFonts();
  const [fontsLoaded, fontError] = useFonts({
    "Outfit-SemiBold": require("../assets/fonts/Outfit-SemiBold.ttf"),
    "Outfit-Bold": require("../assets/fonts/Outfit-Bold.ttf"),
    "Jakarta-Regular": require("../assets/fonts/Jakarta-Regular.ttf"),
    "Jakarta-Medium": require("../assets/fonts/Jakarta-Medium.ttf"),
    "Jakarta-SemiBold": require("../assets/fonts/Jakarta-SemiBold.ttf"),
    "Jakarta-Bold": require("../assets/fonts/Jakarta-Bold.ttf"),
    "Raleway-Medium": require("../assets/fonts/Raleway-Medium.ttf"),
    "Raleway-SemiBold": require("../assets/fonts/Raleway-SemiBold.ttf"),
    "Raleway-Bold": require("../assets/fonts/Raleway-Bold.ttf"),
  });

  const iconsReady = iconsLoaded || !!iconError;
  const fontsReady = fontsLoaded || !!fontError;
  const handleThemeReady = useCallback(() => setThemeReady(true), []);
  const appReady = iconsReady && fontsReady && themeReady;

  useEffect(() => {
    if (!appReady || !artworkLoaded) return;
    let mounted = true;
    void SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => {
        if (mounted) setShowOpeningArtwork(false);
      });
    return () => { mounted = false; };
  }, [appReady, artworkLoaded]);

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
      {showOpeningArtwork ? (
        <View style={styles.openingSplash} pointerEvents="auto" testID="opening-splash-image">
          <Image
            source={require("../assets/images/Splash_screen.png")}
            style={styles.openingSplashArtwork}
            resizeMode="contain"
            onLoad={() => setArtworkLoaded(true)}
            onError={() => setArtworkLoaded(true)}
            accessible={false}
          />
        </View>
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  appCanvas: { flex: 1 },
  openingSplash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
  },
  openingSplashArtwork: {
    width: "72%",
    maxWidth: 360,
    aspectRatio: 1,
  },
});
