import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/auth/AuthContext";
import { roleRouteFor } from "@/src/auth/roleRoutes";
import { useTheme } from "@/src/theme/ThemeProvider";

export default function Index() {
  const { hydrating, token, user } = useAuth();
  const { colors } = useTheme();

  if (hydrating) {
    return (
      <View testID="boot-loader" style={[styles.center, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (!token || !user) {
    return <Redirect href="/login" />;
  }

  if (user.mfa_configured && !user.mfa_enabled && user.role !== "customer" && user.role !== "driver") {
    return <Redirect href="/mfa-setup" />;
  }

  return <Redirect href={roleRouteFor(user.role) as any} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
