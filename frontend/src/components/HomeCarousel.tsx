import React, { useCallback, useEffect, useRef, useState } from "react";
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius } from "@/src/theme/tokens";

// Exactly five approved 1280x720 images, in display order; paths are case sensitive.
const SLIDES = [
  { id: "mixer", source: require("../../assets/images/Mixer.png"), label: "Transit mixer" },
  { id: "kyc", source: require("../../assets/images/KYC-verification.png"), label: "KYC verification" },
  { id: "calculator", source: require("../../assets/images/Free-Calculator.png"), label: "Free RMC calculator" },
  { id: "cashfree", source: require("../../assets/images/Cashfree.png"), label: "Cashfree payments" },
  { id: "country", source: require("../../assets/images/CountryMap.png"), label: "India coverage" },
] as const;
const AUTO_MS = 4500;
const SLIDE_COUNT = SLIDES.length;
const MAX_WIDTH = 720;

export function HomeCarousel({ style }: { style?: ViewStyle }) {
  const { colors } = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const interactingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
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
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (size.w <= 0) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / size.w);
    if (next !== indexRef.current && next >= 0 && next < SLIDE_COUNT) {
      indexRef.current = next;
      setIndex(next);
    }
  }, [size.w]);

  return (
    <View testID="home-promotional-carousel" onLayout={onLayout}
      style={[styles.wrap, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }, style]}>
      {size.w > 0 && size.h > 0 ? (
        <>
          <ScrollView ref={scrollRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16} onScroll={onScroll}
            onScrollBeginDrag={() => { interactingRef.current = true; }}
            onScrollEndDrag={() => { interactingRef.current = false; }}
            onMomentumScrollEnd={() => { interactingRef.current = false; }}
            style={StyleSheet.absoluteFill}>
            {SLIDES.map(slide => (
              <View key={slide.id} style={{ width: size.w, height: size.h }}>
                <Image source={slide.source} style={StyleSheet.absoluteFill}
                  contentFit="contain" contentPosition="center" cachePolicy="memory-disk"
                  accessibilityLabel={slide.label} />
              </View>
            ))}
          </ScrollView>
          <View style={styles.dots} pointerEvents="none">
            {SLIDES.map((slide, i) => (
              <View key={slide.id} style={[styles.dot, i === index
                ? { width: 18, backgroundColor: colors.brand }
                : { width: 6, backgroundColor: "rgba(148,163,184,0.76)" }]} />
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
