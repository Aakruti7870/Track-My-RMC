import React, { useEffect } from "react";
import { AccessibilityInfo, StyleProp, StyleSheet, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/src/theme/ThemeProvider";
import { motion, radius } from "@/src/theme/tokens";

export function Skeleton({
  width,
  height,
  radiusValue = radius.sm,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radiusValue?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.46);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!mounted) return;
      if (reduced) {
        opacity.value = 0.62;
        return;
      }
      opacity.value = withRepeat(
        withTiming(0.9, { duration: Math.max(720, motion.deliberate * 3), easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    });
    return () => {
      mounted = false;
    };
  }, [opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no"
      style={[
        styles.base,
        {
          backgroundColor: colors.isDark ? colors.surfaceTertiary : colors.disabledSurface,
          borderColor: colors.divider,
          borderRadius: radiusValue,
          width: width ?? "100%",
          height: height ?? 16,
        },
        animated,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
