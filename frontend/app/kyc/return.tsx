import React, { useEffect } from "react";
import { Linking, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

const APP_KYC_URL = "trackmyrmc://kyc";

export default function KycReturnScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS === "web") return;
    const timer = setTimeout(() => router.replace("/kyc"), 250);
    return () => clearTimeout(timer);
  }, [router]);

  const openApp = async () => {
    try {
      await Linking.openURL(APP_KYC_URL);
    } catch {
      router.replace("/kyc");
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.surface, paddingTop: insets.top, padding: spacing.lg }}>
      <Card style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <AppText variant="caption" color={colors.brand}>DIGILOCKER RETURN</AppText>
          <AppText variant="title">KYC consent received</AppText>
          <AppText variant="bodyMuted">
            Your DigiLocker consent flow has returned securely to TrackMyRMC. Continue to refresh your KYC status.
          </AppText>
        </View>
        {Platform.OS === "web" ? (
          <>
            <Button label="Open TrackMyRMC App" onPress={openApp} />
            <Button label="Continue on Web" variant="outline" onPress={() => router.replace("/kyc")} />
          </>
        ) : (
          <AppText variant="caption">Returning to your KYC screen…</AppText>
        )}
      </Card>
    </View>
  );
}
