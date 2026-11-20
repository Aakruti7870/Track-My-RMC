import React, { useCallback, useEffect, useRef, useState } from "react";
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useWebCarousel } from "@/src/hooks/useWebCarousel";
import { useTheme } from "@/src/theme/ThemeProvider";
import { radius } from "@/src/theme/tokens";

const SLIDES = [
  { id: "new", source: require("../../assets/images/carousel/order-concrete.webp"), label: "New Order" },
  { id: "track", source: require("../../assets/images/carousel/track-order.webp"), label: "Track Order" },
  { id: "plants", source: require("../../assets/images/carousel/nearby-plants.webp"), label: "Find Plants" },
  { id: "calculator", source: require("../../assets/images/carousel/rmc-calculator.webp"), label: "Calculate Volume" },
  { id: "bulk", source: require("../../assets/images/carousel/bulk-concrete.webp"), label: "Request a Quote" },
  { id: "orders", source: require("../../assets/images/carousel/delivery-challans.webp"), label: "My Orders" },
] as const;
export type CarouselAction = typeof SLIDES[number]["id"];

const AUTO_MS = 4500;
const SLIDE_COUNT = SLIDES.length;
const MAX_WIDTH = 720;

export function HomeCarousel({ onAction, style }: { onAction: (action: CarouselAction) => void; style?: ViewStyle }) {
  const { colors, reduceMotion } = useTheme();
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
  const showSlide = useCallback((next: number) => {
    scrollRef.current?.scrollTo({ x: next * size.w, animated: !reduceMotion });
  }, [size.w, reduceMotion]);
  const { attachScroll, webPaused } = useWebCarousel(scrollRef, size.w, SLIDE_COUNT, showSlide);
  useEffect(() => {
    if (size.w <= 0 || reduceMotion) return;
    const timer = setInterval(() => {
      if (interactingRef.current || webPaused.current) return;
      showSlide((indexRef.current + 1) % SLIDE_COUNT);
    }, AUTO_MS);
    return () => clearInterval(timer);
  }, [size.w, reduceMotion, showSlide, webPaused]);
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
          <ScrollView ref={attachScroll} testID="home-promotional-slides" horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false}
            accessibilityLabel="Promotional banners" role="region" tabIndex={0}
            scrollEventThrottle={16} onScroll={onScroll}
            onScrollBeginDrag={() => { interactingRef.current = true; }}
            onScrollEndDrag={() => { interactingRef.current = false; }}
            onMomentumScrollEnd={() => { interactingRef.current = false; }}
            style={StyleSheet.absoluteFill}>
            {SLIDES.map((slide, i) => (
              <Pressable key={slide.id} testID={`carousel-action-${slide.id}`}
                accessibilityRole="button" accessibilityLabel={slide.label}
                aria-hidden={i !== index} tabIndex={i === index ? 0 : -1}
                importantForAccessibility={i === index ? "yes" : "no-hide-descendants"}
                onPress={() => { if (i === indexRef.current) onAction(slide.id); }} style={{ width: size.w, height: size.h }}>
                <Image source={slide.source} style={StyleSheet.absoluteFill}
                  contentFit="contain" contentPosition="center" cachePolicy="memory-disk"
                  priority={i === 0 ? "high" : "low"} accessible={false} />
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.dots} pointerEvents="box-none">
            {SLIDES.map((slide, i) => (
              <Pressable key={slide.id} testID={`carousel-page-${slide.id}`}
                accessibilityRole="button" accessibilityLabel={`Show banner ${i + 1} of ${SLIDE_COUNT}: ${slide.label}`}
                accessibilityState={{ selected: i === index }} hitSlop={{ top: 12, bottom: 4 }}
                onPress={() => showSlide(i)} style={styles.dotTarget}>
                <View style={[styles.dot, i === index
                  ? { width: 18, backgroundColor: colors.brand }
                  : { width: 6, backgroundColor: "rgba(148,163,184,0.76)" }]} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center", aspectRatio: 16 / 9, borderRadius: radius.xl, overflow: "hidden", borderWidth: 1 },
  dots: { position: "absolute", bottom: 4, left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center" },
  dotTarget: { width: 26, height: 18, justifyContent: "center", alignItems: "center" },
  dot: { height: 6, borderRadius: 3 },
});
