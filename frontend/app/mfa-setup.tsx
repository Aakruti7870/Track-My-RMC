import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";

import { confirmStaffMfaEnrollment, MfaEnrollmentStartResponse, startStaffMfaEnrollment } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { roleRouteFor } from "@/src/auth/roleRoutes";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export default function MfaSetup() {
  const { colors } = useTheme();
  const router = useRouter();
  const { token, user, refreshMe, signOut } = useAuth();
  const [setup, setSetup] = useState<MfaEnrollmentStartResponse | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const centralAdminSetup = user?.role === "central_admin";

  useEffect(() => {
    if (!token || !user) {
      router.replace("/login" as any);
      return;
    }
    if (user.mfa_enabled) {
      router.replace(roleRouteFor(user.role) as any);
      return;
    }
    let active = true;
    (async () => {
      try {
        const response = await startStaffMfaEnrollment(token);
        if (active) setSetup(response);
      } catch (e: any) {
        if (active) setError(e.detail || "Could not start Authenticator setup");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, user, router]);

  const restartSetup = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setSetup(await startStaffMfaEnrollment(token));
      setCode("");
    } catch (e: any) {
      setError(e.detail || "Could not restart Authenticator setup");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!token || code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const response = await confirmStaffMfaEnrollment(token, code);
      setRecoveryCodes(response.recovery_codes);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.detail || "Authenticator code did not match");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const openAuthenticator = async () => {
    if (!setup?.otpauth_uri) return;
    try {
      await Linking.openURL(setup.otpauth_uri);
    } catch {
      setError("Your device did not open an Authenticator app. Use the QR code or manual key instead.");
    }
  };

  const shareRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    await Share.share({
      title: "TrackMyRMC recovery codes",
      message: `TrackMyRMC recovery codes\n\n${recoveryCodes.join("\n")}\n\nEach code works once. Store them securely.`,
    });
  };

  const finish = async () => {
    if (centralAdminSetup) {
      await signOut();
      router.replace("/login" as any);
      return;
    }
    await refreshMe();
    router.replace("/passkey-setup" as any);
  };

  if (recoveryCodes) {
    return (
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.heroIcon, { backgroundColor: colors.brand + "16" }]}>
            <Ionicons name="shield-checkmark" size={34} color={colors.brand} />
          </View>
          <AppText variant="heading" center>Authenticator activated</AppText>
          <AppText variant="bodyMuted" center>Save these one-time recovery codes before continuing. They will not be shown again.</AppText>

          <View style={[styles.codeCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
            {recoveryCodes.map((item) => (
              <AppText key={item} selectable style={[styles.recoveryCode, { color: colors.onSurface }]}>{item}</AppText>
            ))}
          </View>

          <Button label="Share / Save Recovery Codes" onPress={shareRecoveryCodes} icon={<Ionicons name="share-outline" size={18} color={colors.onBrand} />} />
          <Button label={centralAdminSetup ? "I Saved Them — Sign Out" : "I Saved Them — Add Passkey"} onPress={finish} icon={<Ionicons name={centralAdminSetup ? "log-out-outline" : "finger-print-outline"} size={18} color={colors.onBrand} />} />
          <AppText variant="caption" center>{centralAdminSetup ? "Central Admin setup is complete. Future privileged sign-in is web-only at control.trackmyrmc.com." : "Keep recovery codes outside the phone when possible. Each code is invalidated after one use."}</AppText>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.heroIcon, { backgroundColor: colors.brand + "16" }]}>
          <Ionicons name="lock-closed-outline" size={32} color={colors.brand} />
        </View>
        <AppText variant="heading" center>Secure your Plant Staff account</AppText>
        <AppText variant="bodyMuted" center>Set up Google Authenticator, Microsoft Authenticator, Authy, 1Password, or another TOTP-compatible app.</AppText>

        {loading && !setup ? <AppText variant="bodyMuted" center>Preparing secure setup…</AppText> : null}
        {error ? <AppText variant="caption" center color={colors.error}>{error}</AppText> : null}

        {setup ? (
          <>
            <View style={[styles.stepCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <View style={styles.stepTitle}><View style={[styles.stepNumber, { backgroundColor: colors.brand }]}><AppText color={colors.onBrand} style={styles.stepNumberText}>1</AppText></View><AppText variant="label">Add TrackMyRMC to your Authenticator</AppText></View>
              {setup.qr_data_uri ? <Image source={{ uri: setup.qr_data_uri }} style={styles.qr} contentFit="contain" /> : null}
              <Button label="Open Authenticator App" onPress={openAuthenticator} icon={<Ionicons name="open-outline" size={18} color={colors.onBrand} />} />
              <AppText variant="caption" center>Or enter this manual setup key:</AppText>
              <Pressable style={[styles.manualKey, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <AppText selectable style={[styles.manualKeyText, { color: colors.onSurface }]}>{setup.manual_key}</AppText>
              </Pressable>
              <AppText variant="caption" center>{setup.issuer} · {setup.account}</AppText>
            </View>

            <View style={[styles.stepCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <View style={styles.stepTitle}><View style={[styles.stepNumber, { backgroundColor: colors.brand }]}><AppText color={colors.onBrand} style={styles.stepNumberText}>2</AppText></View><AppText variant="label">Confirm the current 6-digit code</AppText></View>
              <Input testID="mfa-setup-code" label="Authenticator code" value={code} onChangeText={(text) => { setCode(text.replace(/\D/g, "").slice(0, 6)); setError(null); }} placeholder="••••••" keyboardType="number-pad" maxLength={6} center autoFocus error={error} />
              <Button testID="mfa-setup-confirm" label="Activate Authenticator" onPress={confirm} loading={loading} disabled={code.length !== 6} icon={<Ionicons name="shield-checkmark-outline" size={18} color={colors.onBrand} />} />
            </View>

            <Pressable onPress={restartSetup}><AppText variant="label" center color={colors.brand}>Restart setup</AppText></Pressable>
          </>
        ) : null}

        <Pressable onPress={signOut} style={styles.signOut}><AppText variant="label" center color={colors.error}>Sign out</AppText></Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: "center" },
  heroIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  stepCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  stepTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNumberText: { fontFamily: fonts.bold, fontSize: fontSize.sm },
  qr: { width: 220, height: 220, alignSelf: "center" },
  manualKey: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  manualKeyText: { fontFamily: fonts.semibold, fontSize: fontSize.base, letterSpacing: 1.3, textAlign: "center" },
  codeCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  recoveryCode: { fontFamily: fonts.semibold, fontSize: fontSize.base, letterSpacing: 1, textAlign: "center" },
  signOut: { paddingVertical: spacing.md },
});