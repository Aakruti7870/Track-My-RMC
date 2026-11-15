import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export type OtpVisualState = "idle" | "checking" | "error" | "success";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onComplete: (value: string) => void;
  state: OtpVisualState;
  busy?: boolean;
  title: string;
  subtitle: string;
  errorText?: string | null;
  countdown?: number;
  onResend?: () => void;
  resendLabel?: string;
  successSubtitle?: string;
  autoFocus?: boolean;
  testID?: string;
  colors: {
    surface: string;
    surfaceSecondary: string;
    onSurface: string;
    onSurfaceSecondary: string;
    onSurfaceTertiary: string;
    border: string;
    brand: string;
    error: string;
  };
};

const OTP_LENGTH = 6;
const SUCCESS = "#28C48D";
const ERROR = "#E5484D";
const SLOT = 44;
const GAP = 8;
const CANVAS_WIDTH = OTP_LENGTH * SLOT + (OTP_LENGTH - 1) * GAP;
const CANVAS_HEIGHT = 210;
const ROW_TOP = 82;
const CENTER_X = CANVAS_WIDTH / 2;
const CENTER_Y = CANVAS_HEIGHT / 2;
const RADIUS = 76;

const rowPositions = Array.from({ length: OTP_LENGTH }, (_, index) => ({
  left: index * (SLOT + GAP),
  top: ROW_TOP,
}));

const orbitPositions = Array.from({ length: OTP_LENGTH }, (_, index) => {
  const angle = (-90 + index * 60) * (Math.PI / 180);
  return {
    left: CENTER_X + Math.cos(angle) * RADIUS - SLOT / 2,
    top: CENTER_Y + Math.sin(angle) * RADIUS - SLOT / 2,
    rotate: index % 2 === 0 ? "-8deg" : "8deg",
  };
});

export function OtpOrbitVerification({
  value,
  onChangeText,
  onComplete,
  state,
  busy = false,
  title,
  subtitle,
  errorText,
  countdown = 0,
  onResend,
  resendLabel = "Resend OTP",
  successSubtitle = "Your verification has been completed.",
  autoFocus = true,
  testID,
  colors,
}: Props) {
  const { reduceMotion } = useTheme();
  const [availableWidth, setAvailableWidth] = useState(CANVAS_WIDTH);
  const inputRef = useRef<TextInput>(null);
  const assembly = useRef(new Animated.Value(0)).current;
  const turn = useRef(new Animated.Value(0)).current;
  const collapse = useRef(new Animated.Value(0)).current;
  const checkingSpin = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0.82)).current;
  const lastCompleted = useRef("");
  const completeRef = useRef(onComplete);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const [animating, setAnimating] = useState(false);

  // A parent countdown can replace callbacks while the orbit is in flight.
  // Keep the latest handler without cancelling a completed six-digit entry.
  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);

  const digits = useMemo(
    () => Array.from({ length: OTP_LENGTH }, (_, index) => value[index] || ""),
    [value],
  );

  useEffect(() => {
    if (state === "checking" && !reduceMotion) {
      checkingSpin.setValue(0);
      const animation = Animated.loop(
        Animated.timing(checkingSpin, {
          toValue: 1,
          duration: 760,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      animation.start();
      return () => animation.stop();
    }
    checkingSpin.stopAnimation();
    return undefined;
  }, [checkingSpin, reduceMotion, state]);

  useEffect(() => {
    if (state === "error") {
      animationRef.current?.stop();
      animationRef.current = null;
      assembly.setValue(0);
      turn.setValue(0);
      collapse.setValue(0);
      setAnimating(false);
      shake.setValue(0);
      if (reduceMotion) return;
      Animated.sequence([
        Animated.timing(shake, { toValue: -7, duration: 70, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 7, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -4, duration: 80, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 70, useNativeDriver: true }),
      ]).start();
    }
  }, [assembly, collapse, reduceMotion, shake, state, turn]);

  useEffect(() => {
    if (state === "success") {
      if (reduceMotion) {
        successScale.setValue(1);
        return;
      }
      successScale.setValue(0.82);
      Animated.spring(successScale, {
        toValue: 1,
        damping: 9,
        stiffness: 140,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    }
  }, [reduceMotion, state, successScale]);

  useEffect(() => {
    if (state === "error" || value.length < OTP_LENGTH) lastCompleted.current = "";
    if (state !== "idle" || busy) return;

    if (value.length < OTP_LENGTH) {
      lastCompleted.current = "";
      animationRef.current?.stop();
      animationRef.current = null;
      assembly.setValue(0);
      turn.setValue(0);
      collapse.setValue(0);
      setAnimating(false);
      return;
    }

    if (value.length !== OTP_LENGTH || value === lastCompleted.current || animationRef.current) return;

    lastCompleted.current = value;
    if (reduceMotion) {
      completeRef.current(value);
      return;
    }

    setAnimating(true);
    inputRef.current?.blur();
    assembly.setValue(0);
    turn.setValue(0);
    collapse.setValue(0);

    const animation = Animated.sequence([
      Animated.timing(assembly, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(turn, {
        toValue: 1,
        duration: 680,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(collapse, {
        toValue: 1,
        duration: 280,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    animationRef.current = animation;
    animation.start(({ finished }) => {
      animationRef.current = null;
      setAnimating(false);
      if (finished) completeRef.current(value);
    });

    return () => {
      animationRef.current?.stop();
      animationRef.current = null;
    };
  }, [assembly, busy, collapse, reduceMotion, state, turn, value]);

  const editable = !busy && !animating && (state === "idle" || state === "error");
  const canvasScale = Math.min(1, availableWidth / CANVAS_WIDTH);
  const sanitize = (text: string) => text.replace(/\D/g, "").slice(0, OTP_LENGTH);
  const canvasRotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const checkingRotate = checkingSpin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const orbitOpacity = assembly.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.25, 1] });
  const collapseOpacity = collapse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.12] });

  if (state === "success") {
    return (
      <View style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: `${SUCCESS}66` }]}>
        <AppText style={[styles.successTitle, { color: SUCCESS }]}>Verified successfully</AppText>
        <AppText variant="bodyMuted" center>{successSubtitle}</AppText>
        <Animated.View style={[styles.successVisual, { transform: [{ scale: successScale }] }]}>
          <View style={[styles.successRingOuter, { borderColor: `${SUCCESS}35` }]} />
          <View style={[styles.successRingInner, { borderColor: `${SUCCESS}55` }]} />
          <View style={[styles.successCheck, { borderColor: SUCCESS, backgroundColor: `${SUCCESS}18` }]}>
            <Ionicons name="checkmark" size={34} color={SUCCESS} />
          </View>
        </Animated.View>
        <View style={styles.secureRow}>
          <Ionicons name="lock-closed-outline" size={16} color={SUCCESS} />
          <AppText style={[styles.secureText, { color: SUCCESS }]}>Verified and secure</AppText>
        </View>
      </View>
    );
  }

  return (
    <Pressable accessible={false} onPress={() => { if (editable) inputRef.current?.focus(); }}>
      <Animated.View
        testID={testID ? `${testID}-card` : undefined}
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: state === "error" ? `${ERROR}88` : colors.border,
          },
          { transform: [{ translateX: shake }] },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <AppText style={[styles.title, { color: state === "error" ? ERROR : colors.onSurface }]}>{title}</AppText>
        <AppText variant="bodyMuted" center style={styles.subtitle}>{subtitle}</AppText>

        <TextInput
          ref={inputRef}
          testID={testID}
          value={value}
          onChangeText={(text) => onChangeText(sanitize(text))}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={OTP_LENGTH}
          autoFocus={autoFocus}
          editable={editable}
          autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
          textContentType="oneTimeCode"
          importantForAutofill="yes"
          style={styles.nativeInput}
          accessibilityLabel="Six digit verification code"
        />

        <View
          testID={testID ? `${testID}-slots` : undefined}
          onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
          style={[styles.canvasViewport, { height: CANVAS_HEIGHT * canvasScale }]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
        >
          <View style={[styles.canvas, {
            left: (availableWidth - CANVAS_WIDTH) / 2,
            top: (CANVAS_HEIGHT * canvasScale - CANVAS_HEIGHT) / 2,
            transform: [{ scale: canvasScale }],
          }]}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.orbitRing,
                {
                  borderColor: state === "error" ? `${ERROR}66` : `${colors.brand}66`,
                  opacity: Animated.multiply(orbitOpacity, collapseOpacity),
                },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.hub,
                {
                  backgroundColor: state === "error" ? ERROR : colors.brand,
                  opacity: orbitOpacity,
                },
              ]}
            />

            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: canvasRotate }] }]}>
              {digits.map((digit, index) => {
                const row = rowPositions[index];
                const orbit = orbitPositions[index];
                const centerLeft = CENTER_X - SLOT / 2;
                const centerTop = CENTER_Y - SLOT / 2;
                const translateX = Animated.add(
                  assembly.interpolate({ inputRange: [0, 1], outputRange: [0, orbit.left - row.left] }),
                  collapse.interpolate({ inputRange: [0, 1], outputRange: [0, centerLeft - orbit.left] }),
                );
                const translateY = Animated.add(
                  assembly.interpolate({ inputRange: [0, 1], outputRange: [0, orbit.top - row.top] }),
                  collapse.interpolate({ inputRange: [0, 1], outputRange: [0, centerTop - orbit.top] }),
                );
                const slotRotate = assembly.interpolate({ inputRange: [0, 1], outputRange: ["0deg", orbit.rotate] });
                const slotScale = collapse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.32] });
                const slotOpacity = collapse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] });
                const hasDigit = Boolean(digit);
                const activeBorder = state === "error" ? ERROR : hasDigit ? colors.brand : colors.border;

                return (
                  <Animated.View
                    key={index}
                    style={[
                      styles.slot,
                      {
                        left: row.left,
                        top: row.top,
                        borderColor: activeBorder,
                        backgroundColor: state === "error" ? `${ERROR}12` : colors.surface,
                        opacity: slotOpacity,
                        transform: [
                          { translateX },
                          { translateY },
                          { rotate: slotRotate },
                          { scale: slotScale },
                        ],
                      },
                    ]}
                  >
                    <AppText style={[styles.digit, { color: state === "error" ? ERROR : colors.onSurface }]}>{digit}</AppText>
                  </Animated.View>
                );
              })}
            </Animated.View>

            {state === "checking" ? (
              <Animated.View
                style={[
                  styles.checkingDot,
                  {
                    borderColor: `${SUCCESS}44`,
                    borderTopColor: SUCCESS,
                    transform: [{ rotate: checkingRotate }],
                  },
                ]}
              />
            ) : null}
          </View>
        </View>

        {animating ? (
          <AppText variant="caption" center color={colors.onSurfaceTertiary}>Verifying secure code…</AppText>
        ) : null}

        {errorText ? (
          <AppText accessibilityLiveRegion="polite" style={[styles.errorText, { color: colors.error }]} center>{errorText}</AppText>
        ) : null}

        {onResend ? (
          <View style={styles.resendRow}>
            <AppText variant="caption">Didn&apos;t receive the code?</AppText>
            {countdown > 0 ? (
              <AppText variant="caption">Resend in {countdown}s</AppText>
            ) : (
              <Pressable accessibilityRole="button" onPress={onResend} hitSlop={10} disabled={!editable}>
                <AppText style={[styles.resendLink, { color: colors.brand }]}>{resendLabel}</AppText>
              </Pressable>
            )}
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  grabber: { width: 40, height: 4, borderRadius: 99, alignSelf: "center", marginBottom: spacing.lg },
  title: { fontFamily: fonts.bold, fontSize: fontSize.xl, textAlign: "center" },
  subtitle: { marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  nativeInput: { position: "absolute", width: 2, height: 2, opacity: 0.01 },
  canvasViewport: { overflow: "hidden" },
  canvas: { position: "absolute", width: CANVAS_WIDTH, height: CANVAS_HEIGHT, flexShrink: 0 },
  orbitRing: { position: "absolute", width: 152, height: 152, left: CENTER_X - 76, top: CENTER_Y - 76, borderWidth: 1.5, borderRadius: 76, borderStyle: "dashed" },
  hub: { position: "absolute", width: 8, height: 8, left: CENTER_X - 4, top: CENTER_Y - 4, borderRadius: 4 },
  slot: { position: "absolute", width: SLOT, height: SLOT, borderWidth: 1.5, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  digit: { fontFamily: fonts.bold, fontSize: 20 },
  checkingDot: { position: "absolute", width: 30, height: 30, left: CENTER_X - 15, top: CENTER_Y - 15, borderWidth: 3, borderRadius: 15 },
  errorText: { fontFamily: fonts.semibold, fontSize: fontSize.sm, marginTop: spacing.xs },
  resendRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.md },
  resendLink: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
  successTitle: { fontFamily: fonts.bold, fontSize: fontSize.xl, textAlign: "center", marginTop: spacing.md },
  successVisual: { width: 180, height: 180, alignSelf: "center", alignItems: "center", justifyContent: "center", marginVertical: spacing.lg },
  successRingOuter: { position: "absolute", width: 170, height: 170, borderWidth: 1, borderRadius: 40 },
  successRingInner: { position: "absolute", width: 116, height: 116, borderWidth: 1, borderRadius: 30 },
  successCheck: { width: 70, height: 70, borderWidth: 2, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  secureRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  secureText: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
});
