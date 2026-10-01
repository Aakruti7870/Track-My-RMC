import React, { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import { AppText } from "@/src/components/ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { spacing } from "@/src/theme/tokens";

export default function PasskeyCeremonyUnavailable() {
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    const handle = setTimeout(() => router.replace("/login" as any), 1500);
    return () => clearTimeout(handle);
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.surface }}>
      <AppText variant="heading" center>Passkey sign-in is disabled</AppText>
      <AppText variant="bodyMuted" center>
        This security method is not available in the current release. Returning to the supported sign-in screen.
      </AppText>
    </View>
  );
}
