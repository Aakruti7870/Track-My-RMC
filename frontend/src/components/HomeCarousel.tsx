import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import { Image } from "expo-image";

import { useTheme } from "@/src/theme/ThemeProvider";
import { glass, radius } from "@/src/theme/tokens";

// The assets are already committed on main. Match exact filenames and requested order.
const slides = [
  { image: require("../../assets/images/Mixer.png"), label: "Transit mixer" },
  { image: require("../../assets/images/KYC-verification.png"), label: "KYC verification" },
  { image: require("../../assets/images/Free-Calculator.png"), label: "Free RMC calculator" },
  { image: require("../../assets/images/Cashfree.png"), label: "Cashfree payments" },
  { image: require("../../assets/images/CountryMap.png"), label: "India service coverage" },
] as const;

const AUTO_MS = 4500;
const SLIDE_COUNT = slides.length;
const MAX_WIDTH = 720;

type Props = { style?: ViewStyle };

export function HomeCarousel({ style }: Props) {
  const { colors } = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const interactingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(prev => Math.abs(prev.w - width) > 0.5 || Math.abs(prev.h - height) > 0.5 ? { w: width, h: height } : prev);
  }, []);

  useEffect(() => {
    if (size.w > 0) scrollRef.current?.scrollTo({ x: indexRef.current * size.w, animated: false });
  }, [size.w]);

  useEffect(() => {
    if (size.w <= 0) return;
    const timer = setInterval(() => {
      if (interactingRef.current) return;
      const next = (indexRef.current + 1) % SLIDE_COUNT;
      indexRef.current = next;
      setIndex(next);
      scrollRef.current?.scrollTo({ x: next * size.w, animated: true });
    }, AUTO_MS);
    return () => clearInterval(timer);
  }, [size.w]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (size.w <= 0) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / size.w);
    if (next !== indexRef.current && next >= 0 && next < SLIDE_COUNT) {
      indexRef.current = next;
      setIndex(next);
    }
  }, [size.w]);

  return (
    <View
      onLayout={onLayout}
      style={[styles.wrap, {
        borderColor: colors.isDark ? glass.darkBorder : glass.lightBorder,
        backgroundColor: colors.isDark ? glass.darkSurface : glass.lightSurface,
      }, style]}
    >
      {size.w > 0 && size.h > 0 ? (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
            onScrollBeginDrag={() => { interactingRef.current = true; }}
            onScrollEndDrag={() => { interactingRef.current = false; }}
            onMomentumScrollEnd={() => { interactingRef.current = false; }}
            style={StyleSheet.absoluteFill}
          >
            {slides.map((slide, i) => (
              <View key={slide.label} style={{ width: size.w, height: size.h }}>
                <Image
                  source={slide.image}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  contentPosition="center"
                  cachePolicy="memory-disk"
                  priority={i === 0 ? "high" : "normal"}
                  accessibilityLabel={slide.label}
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.dots} pointerEvents="none">
            {slides.map((slide, i) => (
              <View
                key={slide.label}
                style={[styles.dot, i === index
                  ? { width: 18, backgroundColor: colors.brand }
                  : { width: 6, backgroundColor: colors.isDark ? "rgba(255,255,255,0.38)" : "rgba(14,17,22,0.28)" }]}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center", aspectRatio: 16 / 9, borderRadius: radius.xl, overflow: "hidden", borderWidth: 1 },
  dots: { position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 },
  dot: { height: 6, borderRadius: 3 },
});
