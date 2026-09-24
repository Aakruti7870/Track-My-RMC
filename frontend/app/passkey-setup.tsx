import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";

import { startStaffPasskeyRegistration } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { roleRouteFor } from "@/src/auth/roleRoutes";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius, spacing } from "@/src/theme/tokens";

export default function PasskeySetup() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ registered?: string }>();
  const { token, user, refreshMe } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(params.registered === "1" || !!user?.passkey_enabled);

  useEffect(() => {
    if (!token || !user) {
      router.replace("/login" as any);
      return;
    }
    if (params.registered === "1") setRegistered(true);
  }, [params.registered, router, token, user]);

  const continueToDashboard = async () => {
    await refreshMe();
    if (user) router.replace(roleRouteFor(user.role) as any);
  };

  const createPasskey = async () => {
    if (!token || code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const returnMode = Platform.OS === "web" ? "web" : "app";
      const request = await startStaffPasskeyRegistration(token, code, returnMode);
      setCode("");
      if (Platform.OS === "web") {
        window.location.assign(request.authorization_url);
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(
        request.authorization_url,
        "trackmyrmc://auth/passkey-setup",
      );
      if (result.type !== "success") {
        throw new Error("Passkey setup was cancelled");
      }
      await refreshMe();
      setRegistered(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e?.detail || e?.message || "Could not create passkey");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}> 
      <StatusBar style="dark" />
      <View style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}> 
        <View style={[styles.icon, { backgroundColor: colors.brand + "16" }]}> 
          <Ionicons name={registered ? "shield-checkmark" : "finger-print-outline"} size={36} color={colors.brand} />
        </View>
        <AppText variant="heading" center>{registered ? "Passkey activated" : "Add a Passkey"}</AppText>
        <AppText variant="bodyMuted" center>
          {registered
            ? "Your Plant Staff account can now use passkey verification as the preferred login method."
            : "Use your phone's fingerprint, face, device PIN, or password manager passkey for phishing-resistant login."}
        </AppText>

        {!registered ? (
          <>
            <View style={[styles.info, { borderColor: colors.border, backgroundColor: colors.surface }]}> 
              <Ionicons name="lock-closed-outline" size={20} color={colors.brand} />
              <AppText variant="caption" style={{ flex: 1 }}>
                Credential changes require a fresh Authenticator code. Your biometric data and private passkey key never leave your device.
              </AppText>
            </View>
            <Input
              testID="passkey-setup-totp"
              label="Current Authenticator code"
              value={code}
              onChangeText={(text) => { setCode(text.replace(/\D/g, "").slice(0, 6)); setError(null); }}
              placeholder="••••••"
              keyboardType="number-pad"
              maxLength={6}
              center
              error={error}
            />
            <Button
              testID="passkey-setup-create"
              label="Create Passkey"
              onPress={createPasskey}
              loading={loading}
              disabled={code.length !== 6}
              icon={<Ionicons name="finger-print-outline" size={20} color={colors.onBrand} />}
            />
            {error ? <AppText variant="caption" center color={colors.error}>{error}</AppText> : null}
            <Pressable testID="passkey-setup-skip" onPress={() => { void continueToDashboard(); }} style={styles.linkButton}>
              <AppText variant="label" center color={colors.brand}>Use Authenticator for now</AppText>
            </Pressable>
          </>
        ) : (
          <>
            <View style={[styles.info, { borderColor: colors.border, backgroundColor: colors.surface }]}> 
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.brand} />
              <AppText variant="caption" style={{ flex: 1 }}>
                Authenticator and recovery codes remain available as controlled fallback methods.
              </AppText>
            </View>
            <Button
              testID="passkey-setup-continue"
              label="Continue to Dashboard"
              onPress={() => { void continueToDashboard(); }}
              icon={<Ionicons name="arrow-forward-outline" size={18} color={colors.onBrand} />}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: spacing.xl },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.lg },
  icon: { width: 76, height: 76, borderRadius: 38, alignSelf: "center", alignItems: "center", justifyContent: "center" },
  info: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  linkButton: { minHeight: 44, justifyContent: "center" },
});
