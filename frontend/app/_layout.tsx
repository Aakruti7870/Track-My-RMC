import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Image, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts } from "expo-font";

// Registers the background location task at JS module scope before any screen
// mounts. TaskManager requires this for Android background execution.
import "@/src/location/tripTracking";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ThemeProvider } from "@/src/theme/ThemeProvider";
import { AuthProvider } from "@/src/auth/AuthContext";
import { ToastProvider } from "@/src/components/ui/Toast";
import { PushNotificationBridge } from "@/src/notifications/PushNotificationBridge";
import { BackgroundLocationConsentProvider } from "@/src/location/BackgroundLocationConsent";
import { SupportWidgetBridge } from "@/src/support/SupportWidgetBridge";

// Keep the native splash visible from cold start until fonts, theme preference,
// and the branded opening artwork are ready. Development warnings remain enabled.
void SplashScreen.preventAutoHideAsync();

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
  });

  const iconsReady = iconsLoaded || !!iconError;
  const fontsReady = fontsLoaded || !!fontError;
  const handleThemeReady = useCallback(() => setThemeReady(true), []);
  const appReady = iconsReady && fontsReady && themeReady;

  useEffect(() => {
    if (!appReady || !artworkLoaded) return;

    void SplashScreen.hideAsync().finally(() => setShowOpeningArtwork(false));
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
                  <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
                  <SupportWidgetBridge />
                </ToastProvider>
              </AuthProvider>
            </ThemeProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      ) : null}
      {showOpeningArtwork ? (
        <View style={styles.openingSplash} pointerEvents="auto">
          <Image
            source={require("../assets/images/splash-image.png")}
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
  openingSplash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101112",
  },
  openingSplashArtwork: {
    width: "72%",
    maxWidth: 360,
    aspectRatio: 1,
  },
});
