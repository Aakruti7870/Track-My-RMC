import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Defs, LinearGradient as SvgGradient, Rect, Stop } from "react-native-svg";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { type Href, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";

import { apiErrorDetail, type MfaEnrollmentStartResponse } from "@/src/api/client";
import { useAuth, type Me } from "@/src/auth/AuthContext";
import { roleRouteFor } from "@/src/auth/roleRoutes";
import { loginPhone } from "@/src/auth/phone";
import { shouldResumeKycAfterLogin } from "@/src/kyc/returnContext";
import { OtpOrbitVerification, OtpVisualState } from "@/src/components/auth/OtpOrbitVerification";
import { AppText } from "@/src/components/ui/AppText";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { useToast } from "@/src/components/ui/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { SupportWidgetBridge } from "@/src/support/SupportWidgetBridge";
import { fonts, fontSize, loginAppearance, radius, spacing } from "@/src/theme/tokens";

// Theme-specific, lossless crops of the approved login artwork.
const HERO_LIGHT = require("../../assets/images/TrackMyRMC_Login_Top_Banner_light.webp");
const HERO_DARK = require("../../assets/images/TrackMyRMC_Login_Top_Banner_Dark.webp");

const PRIVACY_POLICY_URL = "https://trackmyrmc.com/privacy_policy";
const ACCOUNT_DELETION_URL = "https://trackmyrmc.com/account-deletion";
const DEMO_LOGIN_ENABLED = process.env.EXPO_PUBLIC_ENABLE_DEMO_LOGIN === "1";

const DEMO_ROLES = [
  { role: "customer", label: "User" },
  { role: "plant_owner", label: "Owner" },
  { role: "driver", label: "Driver" },
];

type LoginMode = "user" | "plant";
type LoginPhase = "enter" | "user_otp" | "staff_email_otp" | "staff_totp" | "staff_recovery" | "staff_enroll" | "staff_save_recovery";
const RESEND_DELAY_MS = 30_000;
const CARD_RADIUS = 28;

function signedInRoute(user: Me): Href {
  if (user.mfa_configured && !user.mfa_enabled && user.role !== "customer" && user.role !== "driver") {
    return "/mfa-setup";
  }
  return roleRouteFor(user.role) as Href;
}

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function LoginScreen() {
  const { colors, toggle, reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const look = loginAppearance[colors.isDark ? "dark" : "light"];
  const heroSource = colors.isDark ? HERO_DARK : HERO_LIGHT;
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const {
    hydrating,
    token,
    user,
    sessionMessage,
    requestOtp,
    requestStaffOtp,
    verify,
    verifyStaff,
    verifyStaffAuthenticator,
    verifyStaffRecovery,
    startStaffMfaEnrollment,
    confirmStaffMfaEnrollment,
    demoLogin,
    clearStaffChallenge,
  } = useAuth();

  const [mode, setMode] = useState<LoginMode>("user");
  const [phase, setPhase] = useState<LoginPhase>("enter");
  const [mobile, setMobile] = useState("");
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [plantEmail, setPlantEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [mfaEnrollment, setMfaEnrollment] = useState<MfaEnrollmentStartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpVisual, setOtpVisual] = useState<OtpVisualState>("idle");
  const [resendAt, setResendAt] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const requestInFlight = useRef(false);

  useEffect(() => {
    if (!resendAt) return;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (!remaining) setResendAt(0);
    };
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  useEffect(() => {
    if (!hydrating && token && user && phase === "enter" && !loading && otpVisual !== "success") {
      router.replace(signedInRoute(user));
    }
  }, [hydrating, loading, otpVisual, phase, router, token, user]);

  const startCountdown = () => {
    setCountdown(RESEND_DELAY_MS / 1000);
    setResendAt(Date.now() + RESEND_DELAY_MS);
  };

  const clearCountdown = () => {
    setResendAt(0);
    setCountdown(0);
  };

  const changePhase = (nextPhase: LoginPhase) => {
    setPhase(nextPhase);
    setCode("");
    setRecoveryCode("");
    setError(null);
    setOtpVisual("idle");
  };

  const resetEntry = (nextMode: LoginMode) => {
    if (requestInFlight.current) return;
    setMode(nextMode);
    setPhoneFocused(false);
    clearStaffChallenge();
    setIdentifier("");
    setMfaEnrollment(null);
    setOnboardingRequired(false);
    clearCountdown();
    changePhase("enter");
  };

  const runLoginAction = async (action: () => Promise<void>) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      await action();
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  };

  const finishLogin = async (me: Me) => {
    setOtpVisual("success");
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    if (!reduceMotion) await delay(700);

    if (me.role === "customer" && await shouldResumeKycAfterLogin(me.id).catch(() => false)) {
      router.replace("/kyc?returned=1");
      return;
    }
    router.replace(signedInRoute(me));
  };

  const failOtp = (error: unknown, fallback: string) => {
    setError(apiErrorDetail(error, fallback));
    setCode("");
    setOtpVisual("error");
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  };

  const handleSendUserOtp = async () => {
    const fullNumber = loginPhone(mobile);
    if (!fullNumber || hydrating) return;
    await runLoginAction(async () => {
      try {
        await requestOtp(fullNumber);
        setIdentifier(fullNumber);
        changePhase("user_otp");
        startCountdown();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } catch (error) {
        setError(apiErrorDetail(error, "Could not send OTP. Try again."));
      }
    });
  };

  const handleStartPlantLogin = async () => {
    const email = plantEmail.trim().toLowerCase();
    if (!validEmail(email) || hydrating) return;
    await runLoginAction(async () => {
      setOnboardingRequired(false);
      try {
        const response = await requestStaffOtp(email);
        if (response.status === "ONBOARDING_REQUIRED") {
          setPlantEmail(response.email || email);
          changePhase("enter");
          clearCountdown();
          setOnboardingRequired(true);
          return;
        }
        if (response.status !== "OTP_SENT" || response.channel !== "email") {
          setError("Plant Staff secure login could not start");
          return;
        }
        setIdentifier(email);
        setPlantEmail(email);
        changePhase("staff_email_otp");
        startCountdown();
      } catch (error) {
        setError(apiErrorDetail(error, "Could not start Plant Staff login. Try again."));
      }
    });
  };

  const handleVerifyUser = async (otp: string) => {
    if (otp.length !== 6) return;
    await runLoginAction(async () => {
      setOtpVisual("checking");
      try {
        await finishLogin(await verify(identifier, otp));
      } catch (error) {
        failOtp(error, "Could not verify the WhatsApp code. Try again.");
      }
    });
  };

  const loadEnrollment = async (challengeToken?: string) => {
    try {
      setMfaEnrollment(await startStaffMfaEnrollment(challengeToken));
    } catch (error) {
      setError(apiErrorDetail(error, "Could not load authenticator setup. Try again."));
    }
  };

  const handleVerifyStaffEmail = async (otp: string) => {
    if (otp.length !== 6) return;
    await runLoginAction(async () => {
      setOtpVisual("checking");
      try {
        const challenge = await verifyStaff(identifier, otp);
        clearCountdown();
        if (challenge.mfa_setup_required || challenge.status === "MFA_ENROLLMENT_REQUIRED") {
          changePhase("staff_enroll");
          await loadEnrollment(challenge.challenge_token);
        } else {
          changePhase("staff_totp");
        }
      } catch (error) {
        failOtp(error, "Could not verify the email code. Try again.");
      }
    });
  };

  const handleConfirmMfaEnrollment = async (otp: string) => {
    if (otp.length !== 6) return;
    await runLoginAction(async () => {
      setOtpVisual("checking");
      try {
        await confirmStaffMfaEnrollment(otp);
        changePhase("staff_save_recovery");
      } catch (error) {
        failOtp(error, "Could not enable the authenticator. Try again.");
      }
    });
  };

  const handleVerifyAuthenticator = async (otp: string) => {
    if (otp.length !== 6) return;
    await runLoginAction(async () => {
      setOtpVisual("checking");
      try {
        await finishLogin(await verifyStaffAuthenticator(identifier, otp));
      } catch (error) {
        failOtp(error, "Could not verify the authenticator code. Try again.");
      }
    });
  };

  const handleVerifyRecovery = async () => {
    if (recoveryCode.replace(/[^A-Z0-9]/gi, "").length < 8) return;
    await runLoginAction(async () => {
      try {
        const me = await verifyStaffRecovery(identifier, recoveryCode.trim());
        router.replace(signedInRoute(me));
      } catch (error) {
        setError(apiErrorDetail(error, "Could not verify the recovery code. Try again."));
      }
    });
  };

  const resendCurrentOtp = async () => {
    if (Date.now() < resendAt || requestInFlight.current) return;
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
    router.push({
      pathname: "/plant-onboarding",
      params: { email: plantEmail.trim().toLowerCase(), mode: "owner_registration" },
    });
  };

  const otpColors = {
    surface: look.field,
    surfaceSecondary: look.rail,
    onSurface: colors.onSurface,
    onSurfaceSecondary: colors.onSurfaceSecondary,
    onSurfaceTertiary: colors.onSurfaceTertiary,
    border: look.fieldOutline,
    brand: look.link,
    error: colors.error,
  };

  const maskedPhone = identifier.length >= 4 ? `•••••••• ${identifier.slice(-4)}` : "your mobile";

  const editOtp = (next: string) => {
    setCode(next);
    setError(null);
    setOtpVisual("idle");
  };

  const renderHeading = (icon: keyof typeof Ionicons.glyphMap, title: string, subtitle: string) => (
    <View style={styles.headingBlock}>
      <View style={[styles.iconBubble, { backgroundColor: look.iconSurface }]}>
        <Ionicons name={icon} size={24} color={look.selectedIcon} />
      </View>
      <AppText accessibilityRole="header" variant="heading" center>{title}</AppText>
      <AppText variant="bodyMuted" center color={colors.onSurfaceSecondary}>{subtitle}</AppText>
    </View>
  );

  const renderChangeContact = (nextMode: LoginMode) => (
    <Pressable accessibilityRole="button" disabled={loading} onPress={() => resetEntry(nextMode)} style={styles.stepAction}>
      <AppText variant="label" center color={look.link}>
        {nextMode === "user" ? "← Change mobile number" : "← Change email"}
      </AppText>
    </Pressable>
  );

  const renderContinue = (testID: string, label: string, valid: boolean, onPress: () => void) => {
    const disabled = !valid || loading || hydrating;
    const foreground = disabled ? look.disabledText : colors.onBrand;
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.continueButton,
          {
            borderColor: disabled ? look.railOutline : look.tabOutline,
            backgroundColor: disabled ? look.disabledFill : pressed ? colors.brandPressed : colors.brand,
          },
        ]}
      >
        {disabled && <LinearGradient pointerEvents="none" colors={look.disabledGradient} style={StyleSheet.absoluteFill} />}
        {loading
          ? <ActivityIndicator color={foreground} />
          : <Ionicons name="shield-checkmark-outline" size={19} color={foreground} />}
        <AppText style={styles.continueLabel} color={foreground}>{loading ? "Sending code…" : label}</AppText>
      </Pressable>
    );
  };

  const renderForm = () => {
    if (phase === "user_otp") {
      return (
        <View style={styles.formGap}>
          <OtpOrbitVerification
            testID="login-user-otp-input"
            value={code}
            onChangeText={editOtp}
            busy={loading}
            onComplete={handleVerifyUser}
            state={otpVisual}
            title="Verify your number"
            subtitle={`Enter the 6-digit code sent to ${maskedPhone}.`}
            errorText={error}
            countdown={countdown}
            onResend={resendCurrentOtp}
            colors={otpColors}
          />
          {renderChangeContact("user")}
        </View>
      );
    }

    if (phase === "staff_email_otp") {
      return (
        <View style={styles.formGap}>
          <OtpOrbitVerification
            testID="login-plant-otp-input"
            value={code}
            onChangeText={editOtp}
            busy={loading}
            onComplete={handleVerifyStaffEmail}
            state={otpVisual}
            title="Verify approved email"
            subtitle={`Enter the 6-digit code sent to ${identifier}.`}
            errorText={error}
            countdown={countdown}
            onResend={resendCurrentOtp}
            resendLabel="Resend email code"
            colors={otpColors}
          />
          {renderChangeContact("plant")}
        </View>
      );
    }

    if (phase === "staff_enroll") {
      return (
        <View style={styles.formGap}>
          {renderHeading("shield-checkmark-outline", "Set up Authenticator", "Add TrackMyRMC to your authenticator app using the setup key.")}
          {mfaEnrollment ? (
            <>
              <AppText selectable center variant="label" style={styles.setupKey}>{mfaEnrollment.manual_key}</AppText>
              <Pressable accessibilityRole="button" disabled={loading} style={styles.stepAction}
                onPress={() => void openExternal(mfaEnrollment.otpauth_uri)}>
                <AppText variant="label" center color={look.link}>Open authenticator app</AppText>
              </Pressable>
              <OtpOrbitVerification
                testID="login-staff-enroll-input"
                value={code}
                onChangeText={editOtp}
                onComplete={handleConfirmMfaEnrollment}
                state={otpVisual}
                busy={loading}
                title="Confirm setup"
                subtitle="Enter the current 6-digit code from your authenticator."
                errorText={error}
                colors={otpColors}
              />
            </>
          ) : (
            <>
              {error && <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.error}>{error}</AppText>}
              <Button label="Retry setup" loading={loading} onPress={() => void runLoginAction(loadEnrollment)} />
            </>
          )}
          {renderChangeContact("plant")}
        </View>
      );
    }

    if (phase === "staff_save_recovery") {
      return (
        <View style={styles.formGap}>
          {renderHeading("key-outline", "Save your recovery codes", "Keep these one-time codes somewhere safe.")}
          <View style={styles.recoveryCodes}>
            {mfaEnrollment?.recovery_codes.map((item) => (
              <AppText key={item} selectable variant="label" style={styles.setupKey}>{item}</AppText>
            ))}
          </View>
          <Button label="I Saved Them — Continue" onPress={() => {
            setMfaEnrollment(null);
            changePhase("staff_totp");
          }} />
        </View>
      );
    }

    if (phase === "staff_totp") {
      return (
        <View style={styles.formGap}>
          <OtpOrbitVerification
            testID="login-plant-authenticator-input"
            value={code}
            onChangeText={editOtp}
            busy={loading}
            onComplete={handleVerifyAuthenticator}
            state={otpVisual}
            title="Authenticator verification"
            subtitle="Enter the current 6-digit code from your Authenticator app."
            errorText={error}
            colors={otpColors}
            successSubtitle="Authenticator verification completed."
          />
          <View style={styles.linkRow}>
            {renderChangeContact("plant")}
            <Pressable testID="login-use-recovery" accessibilityRole="button" disabled={loading}
              style={styles.stepAction} onPress={() => changePhase("staff_recovery")}>
              <AppText variant="label" color={look.link}>Use recovery code</AppText>
            </Pressable>
          </View>
        </View>
      );
    }

    if (phase === "staff_recovery") {
      return (
        <View style={styles.formGap}>
          {renderHeading("key-outline", "Recovery code", "Use one saved one-time recovery code.")}
          <Input
            testID="login-plant-recovery-input"
            label="Recovery code"
            value={recoveryCode}
            onChangeText={(text) => { setRecoveryCode(text.toUpperCase().slice(0, 20)); setError(null); }}
            placeholder="ABCD-EFGH-JKLM"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!loading}
            onSubmitEditing={handleVerifyRecovery}
            error={error}
          />
          <Button label="Recover & Login" onPress={handleVerifyRecovery} loading={loading}
            disabled={recoveryCode.replace(/[^A-Z0-9]/gi, "").length < 8}
            icon={<Ionicons name="key-outline" size={18} color={colors.onBrand} />} />
          <Pressable accessibilityRole="button" style={styles.stepAction} disabled={loading} onPress={() => changePhase("staff_totp")}>
            <AppText variant="label" center color={look.link}>Back to Authenticator</AppText>
          </Pressable>
        </View>
      );
    }

    if (mode === "user") {
      return (
        <View style={styles.formGap}>
          {renderHeading("phone-portrait-outline", "Welcome back", "Secure access to Track My RMC")}
          <View style={[
            styles.phoneInputWrap,
            { borderColor: error ? colors.error : phoneFocused ? look.tabOutline : look.fieldOutline, backgroundColor: look.field },
          ]}>
            <View style={[styles.prefix, { borderRightColor: look.fieldOutline, backgroundColor: look.prefix }]}><AppText style={styles.prefixText}>{mobile.startsWith("+") ? "INTL" : "+91"}</AppText></View>
            <TextInput
              testID="login-mobile-input"
              value={mobile}
              onChangeText={(text) => { setMobile((text.trimStart().startsWith("+") ? "+" : "") + text.replace(/\D/g, "").slice(0, 15)); setError(null); }}
              accessibilityLabel="WhatsApp mobile number"
              placeholder="10 Digit WhatsApp Number"
              placeholderTextColor={look.placeholder}
              keyboardType="phone-pad"
              inputMode="tel"
              autoComplete="tel"
              editable={!loading}
              onFocus={() => setPhoneFocused(true)}
              onBlur={() => setPhoneFocused(false)}
              selectionColor={look.link}
              onSubmitEditing={handleSendUserOtp}
              maxLength={24}
              style={[styles.phoneInput, { color: colors.onSurface }]}
            />
          </View>
          {sessionMessage ? <AppText testID="login-session-message" variant="caption" color={colors.error}>{sessionMessage}</AppText> : null}
          {error ? <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.error}>{error}</AppText> : null}
          {renderContinue("login-send-otp", "CONTINUE", Boolean(loginPhone(mobile)), handleSendUserOtp)}
        </View>
      );
    }

    return (
      <View style={styles.formGap}>
        {renderHeading("business-outline", "Plant Staff Secure Login", "Use your approved work email.")}
        <Input
          testID="login-plant-email-input"
          label="Enter Registered Work Email"
          value={plantEmail}
          onChangeText={(text) => { setPlantEmail(text.trimStart().toLowerCase()); setError(null); setOnboardingRequired(false); }}
          placeholder="name@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          editable={!loading}
          onSubmitEditing={handleStartPlantLogin}
          error={error}
        />
        <Pressable
          testID="login-open-onboarding-form"
          accessibilityRole="button"
          accessibilityLabel="Register As Plant Owner"
          accessibilityHint="Opens the Plant Owner registration request and prefills the email if entered"
          onPress={openOnboarding}
          disabled={loading}
          style={({ pressed }) => [
            styles.onboardingLink,
            {
              borderColor: colors.isDark ? "rgba(134,239,172,0.60)" : "rgba(22,163,74,0.48)",
              backgroundColor: colors.isDark ? "rgba(21,128,61,0.28)" : "rgba(220,252,231,0.74)",
              shadowColor: "#16A34A",
              opacity: pressed ? 0.88 : 1,
              transform: [{ scale: pressed ? 0.992 : 1 }],
            },
          ]}
        >
          <LinearGradient
            colors={colors.isDark
              ? ["rgba(187,247,208,0.21)", "rgba(21,128,61,0.08)"]
              : ["rgba(255,255,255,0.82)", "rgba(134,239,172,0.30)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.12, y: 1 }}
            style={styles.onboardingLinkContent}
          >
            <Ionicons name="document-text-outline" size={21} color={colors.isDark ? "#BBF7D0" : "#166534"} />
            <AppText style={[styles.onboardingLinkLabel, { color: colors.isDark ? "#BBF7D0" : "#166534" }]}>
              Register As Plant Owner
            </AppText>
            <Ionicons name="arrow-forward" size={18} color={colors.isDark ? "#BBF7D0" : "#166534"} />
          </LinearGradient>
        </Pressable>
        {renderContinue("login-plant-send-otp", "Continue Securely", validEmail(plantEmail), handleStartPlantLogin)}
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

  const heroAspect = (colors.isDark ? 1229 : 1227) / 615;

  return (
    <View style={{ flex: 1, backgroundColor: look.canvas }}>
      <StatusBar style={colors.isDark ? "light" : "dark"} />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: "100%", height: insets.top, backgroundColor: look.heroTop }} />
        <View style={[styles.hero, { aspectRatio: heroAspect, backgroundColor: look.heroEdge }]}>
          <Image
            testID="login-hero"
            source={heroSource}
            style={styles.heroImage}
            contentFit="contain"
            contentPosition="center"
            priority="high"
            accessibilityLabel="Track My RMC. Secure access for concrete operations."
            accessible
            cachePolicy="memory-disk"
            transition={0}
          />
        </View>
        <LinearGradient pointerEvents="none" colors={look.heroFade}
          locations={[0, 0.8, 1]} style={styles.heroFade} />

        <View testID="login-card" style={[styles.loginShell, compact && styles.compactShell, { shadowColor: colors.shadow }]}>
          <LinearGradient pointerEvents="none" colors={look.card} style={styles.sheetFill}
            start={{ x: 0, y: 0 }} end={{ x: 0.9, y: 1 }} />
          <LinearGradient pointerEvents="none" colors={look.cardHighlight} locations={[0, 0.56, 1]}
            start={{ x: 0, y: 0 }} end={{ x: 0.34, y: 0.16 }} style={styles.sheetFill} />
          <Svg width="100%" height="100%" pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden accessible={false}>
            <Defs>
              <SvgGradient id="loginCardRim" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0" stopColor={look.rim[0]} />
                <Stop offset="0.19" stopColor={look.rim[1]} />
                <Stop offset="0.63" stopColor={look.rim[2]} />
                <Stop offset="1" stopColor={look.rim[1]} />
              </SvgGradient>
            </Defs>
            <Rect width="100%" height="100%" rx={CARD_RADIUS} fill="none" stroke="url(#loginCardRim)" strokeWidth={2} />
          </Svg>

          <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: look.rail, borderColor: look.railOutline }]}>
            {([
              { key: "user", testID: "login-user-tab", icon: "person-outline", label: "USER LOGIN" },
              { key: "plant", testID: "login-plant-tab", icon: "people-outline", label: "PLANT STAFF" },
            ] as const).map(({ key, testID, icon, label }) => {
              const selected = mode === key;
              return (
                <Pressable key={key} testID={testID}
                  accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected, disabled: loading }} aria-selected={selected} disabled={loading}
                  onPress={() => { if (!selected) resetEntry(key); }}
                  style={[styles.segment, selected && { borderColor: look.tabOutline }]}>
                  {selected ? <LinearGradient pointerEvents="none" colors={look.tab}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
                  <Ionicons name={icon} size={18} color={selected ? look.selectedIcon : look.inactive} />
                  <AppText style={styles.segmentLabel} color={selected ? look.selectedText : look.inactive}>{label}</AppText>
                </Pressable>
              );
            })}
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
                    onPress={() => void runLoginAction(async () => {
                      try {
                        await finishLogin(await demoLogin(item.role));
                      } catch (error) {
                        setError(apiErrorDetail(error, "Demo login is unavailable"));
                      }
                    })}
                    style={[styles.demoChip, { borderColor: colors.border }]}
                  >
                    <AppText variant="caption">{item.label}</AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.securityNote}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.onSurfaceTertiary} />
            <AppText variant="caption" color={colors.onSurfaceTertiary} style={{ flexShrink: 1 }}>Secured with 6-digit OTP verification</AppText>
          </View>

          <Pressable
            testID="login-review-access"
            accessibilityRole="button"
            accessibilityLabel="Google Play Reviewer Access"
            disabled={loading}
            onPress={() => router.push("/review-access")}
            style={[styles.reviewAccess, { backgroundColor: look.reviewerSurface, borderColor: look.fieldOutline }]}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={look.reviewer} />
            <AppText variant="caption" style={[styles.reviewAccessLabel, { color: colors.onSurface }]}>Google Play Reviewer Access</AppText>
          </Pressable>

          <View style={styles.legalArea}>
            <AppText variant="caption" center color={colors.onSurfaceSecondary}>
              {"By clicking on Login, I accept the\u00A0"}
              <AppText testID="login-terms-link" variant="caption" style={styles.legalLink} color={look.link}
                accessibilityRole="link" onPress={() => { if (!requestInFlight.current) router.push("/terms"); }}>Terms & Conditions</AppText>
              {" & "}
              <AppText testID="login-privacy-link" variant="caption" style={styles.legalLink} color={look.privacy}
                accessibilityRole="link" onPress={() => { if (!requestInFlight.current) void openExternal(PRIVACY_POLICY_URL); }}>Privacy Policy</AppText>
            </AppText>

            <Pressable testID="login-delete-account" accessibilityRole="link" accessibilityLabel="Delete Account"
              style={styles.deleteLink} disabled={loading} onPress={() => void openExternal(ACCOUNT_DELETION_URL)}>
              <Ionicons name="trash-outline" size={16} color={look.delete} />
              <AppText variant="caption" color={look.delete}>Delete Account</AppText>
            </Pressable>
          </View>

          <AppText variant="caption" center color={colors.onSurfaceTertiary} style={styles.credit}>
            {"Powered by\u00A0"}<AppText variant="label" color={colors.onSurface}>Gold e Tech</AppText>
          </AppText>
        </View>
        <View style={[styles.utilityRow, compact && styles.compactUtilityRow]}>
          <SupportWidgetBridge />
          <Pressable accessibilityRole="button" accessibilityLabel="Switch light or dark mode"
            testID="login-theme-toggle" onPress={toggle}
            style={[styles.themeButton, { backgroundColor: look.rail, borderColor: look.railOutline }]}>
            <Ionicons name={colors.isDark ? "sunny-outline" : "moon-outline"} size={19} color={look.inactive} />
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, alignItems: "center" },
  hero: {
    width: "100%",
    maxWidth: 760,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  loginShell: {
    width: "88%",
    maxWidth: 420,
    marginTop: -7,
    borderRadius: CARD_RADIUS,
    paddingHorizontal: 17,
    paddingBottom: 17,
    paddingTop: 22,
    gap: 16,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 8,
  },
  compactShell: { width: "92%", paddingHorizontal: 12 },
  heroFade: { width: "100%", maxWidth: 760, height: 12 },
  sheetFill: { ...StyleSheet.absoluteFillObject, borderRadius: CARD_RADIUS },
  utilityRow: { width: "88%", maxWidth: 420, marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 1 },
  compactUtilityRow: { width: "92%" },
  themeButton: { marginLeft: "auto", width: 44, height: 44, borderRadius: 22, borderWidth: 1,
    alignItems: "center", justifyContent: "center" },
  segmented: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 18,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 14,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: 4,
  },
  segmentLabel: { flexShrink: 1, textAlign: "center", fontFamily: fonts.semibold, fontSize: fontSize.sm, lineHeight: 17 },
  formGap: { gap: 11 },
  headingBlock: { alignItems: "center", gap: 2, paddingBottom: 5 },
  stepAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  setupKey: { alignSelf: "center", textAlign: "center" },
  recoveryCodes: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.md },
  continueButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 15,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: spacing.md,
  },
  continueLabel: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },
  phoneInputWrap: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  prefix: {
    alignSelf: "stretch",
    minWidth: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
  },
  prefixText: { fontFamily: fonts.semibold },
  phoneInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    paddingHorizontal: 10,
    fontFamily: fonts.regular,
    fontSize: fontSize.base,
  },
  securityNote: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 3,
  },
  onboardingLink: {
    width: "100%",
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 2,
  },
  onboardingLinkContent: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  onboardingLinkLabel: {
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: fontSize.base,
    textAlign: "center",
  },
  linkRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  onboardingCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, alignItems: "center" },
  onboardingTitle: { fontFamily: fonts.bold, fontSize: fontSize.lg },
  demoBox: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  demoRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
  demoChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  legalArea: { gap: 2, paddingTop: 2 },
  credit: { marginTop: 2 },
  legalLink: { fontFamily: fonts.semibold, textDecorationLine: "underline" },
  deleteLink: { minHeight: 44, alignSelf: "center", paddingHorizontal: 10, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 5 },
  reviewAccess: {
    alignSelf: "center",
    maxWidth: "100%",
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  reviewAccessLabel: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    textAlign: "center",
  },
});

