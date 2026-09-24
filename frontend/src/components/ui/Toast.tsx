import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, radius, spacing } from "@/src/theme/tokens";
import { AppText } from "./AppText";

type ToastType = "success" | "error" | "info";
type ToastState = { message: string; type: ToastType } | null;

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, type: ToastType = "info") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, 3400);
  }, []);

  const accent = toast?.type === "error" ? colors.error : colors.brand;
  const soft = toast?.type === "error" ? colors.errorSoft : colors.brandSoft;
  const iconName: keyof typeof Ionicons.glyphMap = toast?.type === "success" ? "checkmark-circle" : toast?.type === "error" ? "alert-circle" : "information-circle";
  const title = toast?.type === "success" ? "Done" : toast?.type === "error" ? "Action needed" : "Update";

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          entering={FadeInUp.duration(180)}
          exiting={FadeOutUp.duration(150)}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[styles.wrap, { top: insets.top + spacing.sm }]}
        >
          <View
            style={[
              styles.toast,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: soft, borderColor: accent + "30" }]}>
              <Ionicons name={iconName} size={20} color={accent} />
            </View>
            <View style={styles.copy}>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: accent }}>{title}</AppText>
              <AppText variant="body" style={{ fontFamily: fonts.medium }} numberOfLines={3}>{toast.message}</AppText>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 1000,
    alignItems: "center",
  },
  toast: {
    width: "100%",
    maxWidth: 620,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { minWidth: 0, flex: 1, gap: 1 },
});
