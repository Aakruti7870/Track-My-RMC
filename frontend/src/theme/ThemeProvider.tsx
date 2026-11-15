import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Platform, useColorScheme } from "react-native";

import { storage } from "@/src/utils/storage";
import { ThemeColors, darkColors, lightColors } from "./tokens";

type Scheme = "light" | "dark";
type ThemeMode = "system" | "light" | "dark";

type ThemeContextValue = {
  colors: ThemeColors;
  scheme: Scheme;
  mode: ThemeMode;
  reduceMotion: boolean;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const MODE_KEY = "tmrmc_theme_mode";

export function ThemeProvider({
  children,
  onReady,
}: {
  children: React.ReactNode;
  onReady?: () => void;
}) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() =>
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    if (Platform.OS === "web") {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setReduceMotion(query.matches);
      query.addEventListener("change", update);
      update();
      return () => query.removeEventListener("change", update);
    }

    let active = true;
    let observedChange = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      observedChange = true;
      setReduceMotion(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active && !observedChange) setReduceMotion(enabled);
    }).catch(() => undefined);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      const saved = await storage.getItem<string>(MODE_KEY, "system");
      if (!active) return;

      if (saved === "system" || saved === "light" || saved === "dark") {
        setModeState(saved);
      }
      setReady(true);
      onReady?.();
    })();

    return () => {
      active = false;
    };
  }, [onReady]);

  const scheme: Scheme = mode === "system" ? (system === "light" ? "light" : "dark") : mode;
  const colors = scheme === "light" ? lightColors : darkColors;

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    void storage.setItem(MODE_KEY, nextMode);
  }, []);

  const toggle = useCallback(() => {
    setMode(scheme === "dark" ? "light" : "dark");
  }, [scheme, setMode]);

  const value = useMemo(
    () => ({ colors, scheme, mode, reduceMotion, setMode, toggle }),
    [colors, scheme, mode, reduceMotion, setMode, toggle],
  );

  // Keep the native splash on-screen until the persisted preference is known;
  // otherwise a saved light/system theme can briefly render as the wrong theme.
  if (!ready) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
