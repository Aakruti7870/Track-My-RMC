import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { startStaffPasskeyAuthentication } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { roleRouteFor } from "@/src/auth/roleRoutes";
import { OtpOrbitVerification, OtpVisualState } from "@/src/components/auth/OtpOrbitVerification";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const HERO_LIGHT = require("../../assets/images/login-hero-light.jpg");
const HERO_DARK = require("../../assets/images/login-hero-dark.jpg");

const PRIVACY_POLICY_URL = "https://trackmyrmc.com/privacy_policy";
const ACCOUNT_DELETION_URL = "https://trackmyrmc.com/account-deletion";
const SUCCESS = "#28C48D";
const ERROR = "#E5484D";
const DEMO_LOGIN_ENABLED = process.env.EXPO_PUBLIC_ENABLE_DEMO_LOGIN === "1";

const DEMO_ROLES = [
  { role: "customer", label: "User" },
  { role: "plant_owner", label: "Owner" },
  { role: "driver", label: "Driver" },
];

type LoginMode = "user" | "plant";
type LoginPhase = "enter" | "user_otp" | "staff_email_otp" | "staff_passkey" | "staff_totp" | "staff_recovery";

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function LoginScreen() {
  const { colors } = useTheme();
  const heroSource = colors.isDark ? HERO_DARK : HERO_LIGHT;
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const {
    hydrating,
    token,
    user,
    requestOtp,
    requestStaffOtp,
    verify,
    verifyStaff,
    verifyStaffAuthenticator,
    verifyStaffRecovery,
    completeStaffPasskey,
    demoLogin,
  } = useAuth();

  const [mode, setMode] = useState<LoginMode>("user");
  const [phase, setPhase] = useState<LoginPhase>("enter");
  const [mobile, setMobile] = useState("");
  const [plantEmail, setPlantEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpVisual, setOtpVisual] = useState<OtpVisualState>("idle");
  const [countdown, setCountdown] = useState(0);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  useEffect(() => {
    if (!hydrating && token && user) {
      if (phase !== "enter" || otpVisual === "success") return;
      if (user.mfa_configured && !user.mfa_enabled && user.role !== "customer" && user.role !== "driver") {
        router.replace("/mfa-setup" as any);
      } else {
        router.replace(roleRouteFor(user.role) as any);
      }
    }
  }, [hydrating, otpVisual, phase, router, token, user]);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const startCountdown = (seconds = 30) => {
    setCountdown(seconds);
    clearTimer();
    timer.current = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          clearTimer();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const resetEntry = (nextMode: LoginMode) => {
    setMode(nextMode);
    setPhase("enter");
    setCode("");
    setRecoveryCode("");
    setError(null);
    setOtpVisual("idle");
    setCountdown(0);
    setOnboardingRequired(false);
    clearTimer();
  };

  const finishLogin = async (me: Awaited<ReturnType<typeof verify>>, offerPasskey = false) => {
    setOtpVisual("success");
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await delay(700);

    if (me.mfa_configured && !me.mfa_enabled && me.role !== "customer" && me.role !== "driver") {
      router.replace("/mfa-setup" as any);
      return;
    }
    if (offerPasskey && me.mfa_enabled && !me.passkey_enabled && me.role !== "customer" && me.role !== "driver") {
      router.replace("/passkey-setup" as any);
      return;
    }
    router.replace(roleRouteFor(me.role) as any);
  };

  const failOtp = async (message: string) => {
    setError(message);
    setOtpVisual("error");
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    await delay(850);
    setCode("");
    setOtpVisual("idle");
  };

  const handleSendUserOtp = async () => {
    setError(null);
    if (mobile.length !== 10) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }
    const fullNumber = `+91${mobile}`;
    setLoading(true);
    try {
      const response = await requestOtp(fullNumber);
      if (response.channel !== "sms") throw { detail: "User Login requires mobile OTP" };
      setIdentifier(fullNumber);
      setCode("");
      setOtpVisual("idle");
      setPhase("user_otp");
      startCountdown(30);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.detail || "Could not send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleStartPlantLogin = async () => {
    setError(null);
    setOnboardingRequired(false);
    const email = plantEmail.trim().toLowerCase();
    if (!validEmail(email)) {
      setError("Enter a valid approved email address");
      return;
    }
    setLoading(true);
    try {
      const response = await requestStaffOtp(email);
      if (response.status === "ONBOARDING_REQUIRED") {
        setPlantEmail(response.email || email);
        setOnboardingRequired(true);
        return;
      }
      setIdentifier(email);
      setPlantEmail(email);
      setCode("");
      setRecoveryCode("");
      setOtpVisual("idle");
      if (response.status === "AUTHENTICATOR_REQUIRED") {
        setPhase(response.passkey_available ? "staff_passkey" : "staff_totp");
        clearTimer();
        return;
      }
      if (response.status !== "OTP_SENT" || response.channel !== "email") {
        throw { detail: "Plant Staff secure login could not start" };
      }
      setPhase("staff_email_otp");
      startCountdown(30);
    } catch (e: any) {
      setError(e.detail || "Could not start Plant Staff login");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyUser = useCallback(async (otp: string) => {
    if (loading || otp.length !== 6) return;
    setError(null);
    setOtpVisual("checking");
    setLoading(true);
    try {
      const me = await verify(identifier, otp);
      await finishLogin(me);
    } catch (e: any) {
      await failOtp(e.detail || "Incorrect OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [identifier, loading, verify]);

  const handleVerifyStaffEmail = useCallback(async (otp: string) => {
    if (loading || otp.length !== 6) return;
    setError(null);
    setOtpVisual("checking");
    setLoading(true);
    try {
      const me = await verifyStaff(identifier, otp);
      await finishLogin(me);
    } catch (e: any) {
      await failOtp(e.detail || "Incorrect or expired email OTP.");
    } finally {
      setLoading(false);
    }
  }, [identifier, loading, verifyStaff]);

  const handleVerifyAuthenticator = useCallback(async (otp: string) => {
    if (loading || otp.length !== 6) return;
    setError(null);
    setOtpVisual("checking");
    setLoading(true);
    try {
      const me = await verifyStaffAuthenticator(identifier, otp);
      await finishLogin(me, true);
    } catch (e: any) {
      await failOtp(e.detail || "Incorrect Authenticator code.");
    } finally {
      setLoading(false);
    }
  }, [identifier, loading, verifyStaffAuthenticator]);

  const handleVerifyPasskey = async () => {
    setLoading(true);
    setError(null);
    try {
      const returnMode = Platform.OS === "web" ? "web" : "app";
      const request = await startStaffPasskeyAuthentication(identifier, returnMode);
      if (Platform.OS === "web") {
        window.location.assign(request.authorization_url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(request.authorization_url, "trackmyrmc://auth/passkey");
      if (result.type !== "success") throw new Error("Passkey login was cancelled");
      const parsed = Linking.parse(result.url);
      const rawCode = parsed.queryParams?.code;
      const handoff = Array.isArray(rawCode) ? String(rawCode[0] || "") : String(rawCode || "");
      if (handoff.length < 24) throw new Error("Secure passkey return code was missing");
      const me = await completeStaffPasskey(handoff);
      router.replace(roleRouteFor(me.role) as any);
    } catch (e: any) {
      setError(e?.detail || e?.message || "Passkey verification could not be completed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRecovery = async () => {
    setError(null);
    if (recoveryCode.replace(/[^A-Z0-9]/gi, "").length < 8) {
      setError("Enter one of your saved recovery codes");
      return;
    }
    setLoading(true);
    try {
      const me = await verifyStaffRecovery(identifier, recoveryCode.trim());
      router.replace(roleRouteFor(me.role) as any);
    } catch (e: any) {
      setError(e.detail || "Invalid or already used recovery code");
    } finally {
      setLoading(false);
    }
  };

  const resendCurrentOtp = async () => {
    if (countdown > 0) return;
    if (phase === "user_otp") await handleSendUserOtp();
    if (phase === "staff_email_otp") await handleStartPlantLogin();
  };

  const openExternal = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast("Unable to open this link on your device", "error");
    }
  };

  const openOnboarding = () => {
    router.push({ pathname: "/plant-onboarding" as any, params: { email: plantEmail.trim().toLowerCase() } } as any);
  };

  const otpColors = {
    surface: colors.surface,
    surfaceSecondary: colors.surfaceSecondary,
    onSurface: colors.onSurface,
    onSurfaceSecondary: colors.onSurfaceSecondary,
    onSurfaceTertiary: colors.onSurfaceTertiary,
    border: colors.border,
    brand: colors.brand,
    error: colors.error,
  };

  const maskedPhone = identifier.length >= 4 ? `+91 •••••• ${identifier.slice(-4)}` : "+91 mobile";

  const renderForm = () => {
    if (phase === "user_otp") {
      return (
        <View style={styles.formGap}>
          <OtpOrbitVerification
            testID="login-user-otp-input"
            value={code}
            onChangeText={(next) => { setCode(next); setError(null); }}
            onComplete={handleVerifyUser}
            state={otpVisual}
            title="Verify your number"
            subtitle={`Enter the 6-digit code sent to ${maskedPhone}.`}
            errorText={error}
            countdown={countdown}
            onResend={resendCurrentOtp}
            colors={otpColors}
          />
          <Pressable onPress={() => resetEntry("user")} hitSlop={10}>
            <AppText variant="label" center color={colors.brand}>← Change mobile number</AppText>
          </Pressable>
        </View>
      );
    }

    if (phase === "staff_email_otp") {
      return (
        <View style={styles.formGap}>
          <OtpOrbitVerification
            testID="login-plant-otp-input"
            value={code}
            onChangeText={(next) => { setCode(next); setError(null); }}
            onComplete={handleVerifyStaffEmail}
            state={otpVisual}
            title="Verify approved email"
            subtitle={`Enter the 6-digit code sent to ${plantEmail}.`}
            errorText={error}
            countdown={countdown}
            onResend={resendCurrentOtp}
            resendLabel="Resend email code"
            colors={otpColors}
          />
          <Pressable onPress={() => resetEntry("plant")} hitSlop={10}>
            <AppText variant="label" center color={colors.brand}>← Change email</AppText>
          </Pressable>
        </View>
      );
    }

    if (phase === "staff_totp") {
      return (
        <View style={styles.formGap}>
          <OtpOrbitVerification
            testID="login-plant-authenticator-input"
            value={code}
            onChangeText={(next) => { setCode(next); setError(null); }}
            onComplete={handleVerifyAuthenticator}
            state={otpVisual}
            title="Authenticator verification"
            subtitle="Enter the current 6-digit code from your Authenticator app."
            errorText={error}
            colors={otpColors}
            successSubtitle="Authenticator verification completed."
          />
          <View style={styles.linkRow}>
            <Pressable onPress={() => resetEntry("plant")}><AppText variant="label" color={colors.brand}>← Change email</AppText></Pressable>
            <Pressable testID="login-use-recovery" onPress={() => { setRecoveryCode(""); setCode(""); setError(null); setPhase("staff_recovery"); }}>
              <AppText variant="label" color={colors.brand}>Use recovery code</AppText>
            </Pressable>
          </View>
        </View>
      );
    }

    if (phase === "staff_passkey") {
      return (
        <View style={styles.formGap}>
          <View style={styles.headingBlock}>
            <Ionicons name="finger-print-outline" size={30} color={colors.brand} />
            <AppText variant="heading" center>Passkey verification</AppText>
            <AppText variant="bodyMuted" center>Use your trusted device credential, or continue with Authenticator.</AppText>
          </View>
          <Button testID="login-plant-passkey" label="Continue with Passkey" onPress={handleVerifyPasskey} loading={loading} icon={<Ionicons name="finger-print-outline" size={20} color={colors.onBrand} />} />
          {error ? <AppText variant="caption" center color={colors.error}>{error}</AppText> : null}
          <Pressable testID="login-use-authenticator" onPress={() => { setCode(""); setError(null); setPhase("staff_totp"); }}>
            <AppText variant="label" center color={colors.brand}>Use Authenticator instead</AppText>
          </Pressable>
        </View>
      );
    }

    if (phase === "staff_recovery") {
      return (
        <View style={styles.formGap}>
          <View style={styles.headingBlock}>
            <Ionicons name="key-outline" size={28} color={colors.brand} />
            <AppText variant="heading" center>Recovery code</AppText>
            <AppText variant="bodyMuted" center>Use one saved one-time recovery code.</AppText>
          </View>
          <Input
            testID="login-plant-recovery-input"
            label="Recovery code"
            value={recoveryCode}
            onChangeText={(text) => { setRecoveryCode(text.toUpperCase().slice(0, 20)); setError(null); }}
            placeholder="ABCD-EFGH-JKLM"
            autoCapitalize="characters"
            autoCorrect={false}
            error={error}
          />
          <Button label="Recover & Login" onPress={handleVerifyRecovery} loading={loading} icon={<Ionicons name="key-outline" size={18} color={colors.onBrand} />} />
          <Pressable onPress={() => { setError(null); setCode(""); setOtpVisual("idle"); setPhase("staff_totp"); }}>
            <AppText variant="label" center color={colors.brand}>Back to Authenticator</AppText>
          </Pressable>
        </View>
      );
    }

    if (mode === "user") {
      return (
        <View style={styles.formGap}>
          <View style={styles.headingBlock}>
            <View style={[styles.iconBubble, { backgroundColor: colors.brandSoft, borderColor: `${colors.brand}42` }]}>
              <Ionicons name="phone-portrait-outline" size={24} color={colors.brand} />
            </View>
            <AppText variant="heading" center>Welcome back</AppText>
            <AppText variant="bodyMuted" center>Secure access to Track My RMC</AppText>
          </View>
          <View style={[styles.phoneInputWrap, { borderColor: error ? colors.error : colors.border, backgroundColor: colors.surface }]}> 
            <View style={[styles.prefix, { borderRightColor: colors.border }]}><AppText style={styles.prefixText}>+91</AppText></View>
            <TextInput
              testID="login-mobile-input"
              value={mobile}
              onChangeText={(text) => { setMobile(text.replace(/\D/g, "").slice(0, 10)); setError(null); }}
              placeholder="Enter 10-digit mobile number"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={10}
              style={[styles.phoneInput, { color: colors.onSurface }]}
            />
          </View>
          {error ? <AppText variant="caption" color={colors.error}>{error}</AppText> : null}
          <Button label="CONTINUE" onPress={handleSendUserOtp} loading={loading} disabled={mobile.length !== 10} icon={<Ionicons name="shield-checkmark-outline" size={19} color={colors.onBrand} />} />
          <View style={styles.securityNote}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.onSurfaceTertiary} />
            <AppText variant="caption" color={colors.onSurfaceTertiary}>6-digit OTP verification</AppText>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.formGap}>
        <View style={styles.headingBlock}>
          <View style={[styles.iconBubble, { backgroundColor: colors.brandSoft, borderColor: `${colors.brand}42` }]}>
            <Ionicons name="business-outline" size={24} color={colors.brand} />
          </View>
          <AppText variant="heading" center>Plant Staff Secure Login</AppText>
          <AppText variant="bodyMuted" center>Use your approved work email.</AppText>
        </View>
        <Input
          testID="login-plant-email-input"
          label="Work email"
          value={plantEmail}
          onChangeText={(text) => { setPlantEmail(text.trimStart().toLowerCase()); setError(null); setOnboardingRequired(false); }}
          placeholder="name@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          error={error}
        />
        <Button testID="login-plant-send-otp" label="Continue Securely" onPress={handleStartPlantLogin} loading={loading} disabled={!validEmail(plantEmail)} icon={<Ionicons name="shield-checkmark-outline" size={18} color={colors.onBrand} />} />
        <View style={styles.altAuthRow}>
          <View style={[styles.altAuthCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Ionicons name="key-outline" size={18} color={colors.brand} />
            <View style={styles.altAuthText}>
              <AppText variant="label">Authenticator</AppText>
              <AppText variant="caption" color={colors.onSurfaceTertiary}>Available after approved email</AppText>
            </View>
          </View>
          <View style={[styles.altAuthCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Ionicons name="finger-print-outline" size={18} color={colors.brand} />
            <View style={styles.altAuthText}>
              <AppText variant="label">Passkey</AppText>
              <AppText variant="caption" color={colors.onSurfaceTertiary}>Trusted-device verification</AppText>
            </View>
          </View>
        </View>
        {onboardingRequired ? (
          <View style={[styles.onboardingCard, { borderColor: `${colors.brand}55`, backgroundColor: colors.brandSoft }]}> 
            <AppText style={styles.onboardingTitle}>Welcome to TrackMyRMC</AppText>
            <AppText variant="caption" center>This email is not associated with an approved plant account. Submit onboarding details for Authority review.</AppText>
            <Button testID="login-get-onboard" label="Get Onboard" onPress={openOnboarding} />
          </View>
        ) : null}
      </View>
    );
  };

  const heroBackground = colors.isDark ? "#080A0C" : "#F7F8F6";

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={colors.isDark ? "light" : "dark"} />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: "100%", height: insets.top, backgroundColor: heroBackground }} />
        <View style={[styles.hero, { backgroundColor: heroBackground }]}>
          <Image
            source={heroSource}
            style={styles.heroImage}
            contentFit="contain"
            contentPosition="center"
            priority="high"
            cachePolicy="memory-disk"
            transition={0}
          />
          <LinearGradient
            pointerEvents="none"
            colors={colors.isDark ? ["rgba(0,0,0,0)", "rgba(0,0,0,0.02)", colors.surface] : ["rgba(255,255,255,0)", "rgba(255,255,255,0.02)", colors.surface]}
            locations={[0, 0.80, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <View style={[styles.loginShell, {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.isDark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.08)",
          shadowColor: colors.isDark ? "#000000" : "#111827",
        }]}> 
          <View style={styles.sheetHandleWrap}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.isDark ? "rgba(255,255,255,0.18)" : "rgba(15,23,42,0.12)" }]} />
          </View>

          <View style={[styles.segmented, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
            <Pressable testID="login-user-tab" onPress={() => resetEntry("user")} style={[styles.segment, mode === "user" && { backgroundColor: colors.brandSoft, borderColor: `${colors.brand}88` }]}> 
              <Ionicons name="person-outline" size={18} color={mode === "user" ? colors.brand : colors.onSurfaceTertiary} />
              <AppText style={styles.segmentLabel} color={mode === "user" ? colors.onSurface : colors.onSurfaceTertiary}>USER LOGIN</AppText>
            </Pressable>
            <Pressable testID="login-plant-tab" onPress={() => resetEntry("plant")} style={[styles.segment, mode === "plant" && { backgroundColor: colors.brandSoft, borderColor: `${colors.brand}88` }]}> 
              <Ionicons name="people-outline" size={18} color={mode === "plant" ? colors.brand : colors.onSurfaceTertiary} />
              <AppText style={styles.segmentLabel} color={mode === "plant" ? colors.onSurface : colors.onSurfaceTertiary}>PLANT STAFF</AppText>
            </Pressable>
          </View>

          {renderForm()}

          {DEMO_LOGIN_ENABLED ? (
            <View style={[styles.demoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
              <AppText variant="caption" center>Google Play review demo</AppText>
              <View style={styles.demoRow}>
                {DEMO_ROLES.map((item) => (
                  <Pressable
                    key={item.role}
                    disabled={loading}
                    onPress={async () => {
                      try {
                        const me = await demoLogin(item.role);
                        router.replace(roleRouteFor(me.role) as any);
                      } catch (e: any) {
                        setError(e.detail || "Demo login is unavailable");
                      }
                    }}
                    style={[styles.demoChip, { borderColor: colors.border }]}
                  >
                    <AppText variant="caption">{item.label}</AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.legalArea}>
          <AppText variant="caption" center style={{ color: colors.onSurfaceTertiary }}>
            {"By clicking on Login, I accept the "}
            <AppText
              testID="login-terms-link"
              variant="caption"
              style={[styles.legalLink, { color: colors.onSurface, textDecorationColor: SUCCESS }]}
              onPress={() => router.push("/terms" as any)}
            >Terms & Conditions</AppText>
            {" & "}
            <AppText
              testID="login-privacy-link"
              variant="caption"
              style={[styles.legalLink, { color: colors.onSurface, textDecorationColor: SUCCESS }]}
              onPress={() => void openExternal(PRIVACY_POLICY_URL)}
            >Privacy Policy</AppText>
          </AppText>

          <AppText
            testID="login-delete-account"
            variant="caption"
            center
            style={[styles.legalLink, { color: colors.onSurface, textDecorationColor: ERROR }]}
            onPress={() => void openExternal(ACCOUNT_DELETION_URL)}
          >Delete Account</AppText>

          <View style={styles.securityNote}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.onSurfaceTertiary} />
            <AppText variant="caption" color={colors.onSurfaceTertiary}>Secured with 6-digit OTP verification</AppText>
          </View>
        </View>

        <Pressable testID="login-review-access" onPress={() => router.push("/review-access" as any)} style={styles.reviewLink} hitSlop={10}>
          <AppText variant="caption" center color={colors.onSurfaceTertiary}>REVIEW APP · Google Play reviewer access</AppText>
        </Pressable>

        <AppText variant="caption" center color={colors.onSurfaceTertiary} style={styles.poweredFooter}>Powered by <AppText variant="label">Gold e Tech</AppText></AppText>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, alignItems: "center" },
  hero: {
    width: "100%",
    maxWidth: 760,
    aspectRatio: 16 / 9,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  loginShell: {
    width: "92%",
    maxWidth: 470,
    marginTop: -24,
    borderWidth: 1,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.lg,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 8,
  },
  sheetHandleWrap: { alignItems: "center", paddingTop: 2, marginBottom: -2 },
  sheetHandle: { width: 44, height: 5, borderRadius: radius.pill },
  segmented: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 18,
    padding: 5,
    gap: 5,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  segmentLabel: { fontFamily: fonts.semibold, fontSize: fontSize.sm, letterSpacing: 0.2 },
  formGap: { gap: spacing.md },
  headingBlock: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xs },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  phoneInputWrap: {
    height: 56,
    maxHeight: 56,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  prefix: {
    height: 56,
    minWidth: 62,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
  },
  prefixText: { fontFamily: fonts.semibold },
  phoneInput: {
    flex: 1,
    height: 56,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular,
    fontSize: fontSize.base,
  },
  securityNote: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: -2,
  },
  altAuthRow: { flexDirection: "row", gap: spacing.sm },
  altAuthCard: {
    flex: 1,
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  altAuthText: { flex: 1, gap: 1 },
  linkRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  onboardingCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, alignItems: "center" },
  onboardingTitle: { fontFamily: fonts.bold, fontSize: fontSize.lg },
  demoBox: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  demoRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
  demoChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  legalArea: { width: "92%", maxWidth: 470, paddingTop: spacing.lg, paddingHorizontal: spacing.sm, gap: spacing.md },
  legalLink: { fontFamily: fonts.semibold },
  poweredFooter: { marginTop: spacing.sm },
  reviewLink: { marginTop: spacing.md, paddingVertical: spacing.sm },
});
