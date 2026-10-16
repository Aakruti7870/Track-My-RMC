import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import Svg, { Circle, Ellipse, Path, G } from "react-native-svg";

export type PuppyMood = "idle" | "greeting" | "thinking" | "reply";
type Props = { mood?: PuppyMood; size?: number; active?: boolean };

/**
 * Dependency-free (apart from existing react-native-svg) vector mascot.
 * Motion uses native-driver transforms, and stops for reduced motion/inactivity.
 * No AI keys, requests, extra floating overlays, or native dependencies.
 */
export function AnimatedPuppy({ mood = "idle", size = 52, active = true }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setReducedMotion(value);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);
  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    if (!active || reducedMotion) return;
    const halfDuration = mood === "greeting" ? 450 : mood === "thinking" ? 1250 : mood === "reply" ? 375 : 1750;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: halfDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: halfDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, mood, progress, reducedMotion]);
  const tilt = progress.interpolate({ inputRange: [0, 1], outputRange: ["-3deg", mood === "greeting" ? "7deg" : "3deg"] });
  const lift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, mood === "reply" ? -5 : -2] });
  return (
    <Animated.View accessibilityElementsHidden style={{ width: size, height: size, transform: [{ rotate: tilt }, { translateY: lift }] }}>
      <Svg viewBox="0 0 100 100" width={size} height={size}>
        <G stroke="#081449" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round">
          <Path d="M68 70 C96 43 105 81 82 85 C100 72 83 63 78 78" fill="#FFA420" />
          <Ellipse cx={49} cy={75} rx={27} ry={22} fill="#FFAB25" />
          <Ellipse cx={48} cy={76} rx={16} ry={18} fill="#FFF9F2" stroke="none" />
          <Path d="M19 30 L17 7 Q19 1 26 6 L40 19 M63 19 L79 5 Q85 2 86 11 L83 36" fill="#FFAD28" />
          <Path d="M23 22 L22 11 L34 21 M70 20 L80 11 L80 28" fill="#FFF9F2" strokeWidth={1.5} />
          <Ellipse cx={49} cy={42} rx={36} ry={32} fill="#FFA51F" />
          <Path d="M17 47 Q24 39 34 46 Q45 51 50 43 Q62 39 68 45 Q81 43 84 51 Q80 70 51 73 Q22 71 17 54Z" fill="#FFF9F2" stroke="none" />
          <Ellipse cx={35} cy={39} rx={6} ry={9} fill="#071448" />
          <Ellipse cx={65} cy={39} rx={6} ry={9} fill="#071448" />
          <Circle cx={37} cy={36} r={2.4} fill="#FFFFFF" stroke="none" />
          <Circle cx={67} cy={36} r={2.4} fill="#FFFFFF" stroke="none" />
          <Ellipse cx={24} cy={52} rx={7} ry={5} fill="#FF8C9E" stroke="none" />
          <Ellipse cx={76} cy={52} rx={7} ry={5} fill="#FF8C9E" stroke="none" />
          <Path d="M44 50 Q50 46 56 50 Q54 56 50 56 Q46 56 44 50Z" fill="#081449" />
          <Path d="M50 56 Q43 65 38 57 M50 56 Q57 65 62 57" fill="none" />
          <Path d="M24 70 Q8 68 10 53 Q12 48 18 51 L29 60" fill="#FFA51F" />
          <Ellipse cx={16} cy={51} rx={11} ry={11} fill="#FFF9F2" />
          <Circle cx={16} cy={54} r={4} fill="#FF8C9E" stroke="none" />
          <Circle cx={10} cy={47} r={2} fill="#FF8C9E" stroke="none" />
          <Circle cx={17} cy={44} r={2} fill="#FF8C9E" stroke="none" />
          <Circle cx={23} cy={48} r={2} fill="#FF8C9E" stroke="none" />
          <Path d="M67 68 Q77 64 79 79" fill="none" strokeWidth={8} />
          <Ellipse cx={34} cy={92} rx={12} ry={6} fill="#FFF9F2" />
          <Ellipse cx={64} cy={92} rx={12} ry={6} fill="#FFF9F2" />
        </G>
      </Svg>
    </Animated.View>
  );
}
