import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/AuthContext";
import { roleRouteFor } from "@/src/auth/roleRoutes";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

export default function PasskeySetupUnavailable() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.surface }}>
      <AppText variant="heading" center>Passkeys are temporarily unavailable</AppText>
      <AppText variant="bodyMuted" center>
        TrackMyRMC has disabled passkey registration until server-side WebAuthn challenge and signature verification is complete. Use your configured email OTP or Authenticator method instead.
      </AppText>
      <Button label="Continue to TrackMyRMC" onPress={() => router.replace((user ? roleRouteFor(user.role) : "/login") as any)} />
    </View>
  );
}
