import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { AppText } from "@/src/components/ui/AppText";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const HERO_LIGHT = require("../../assets/images/login-hero-light.jpg");
const HERO_DARK = require("../../assets/images/login-hero-dark.jpg");
const AUTOPLAY_MS = 4500;

type Slide = {
  id: "live" | "order" | "plants" | "challan";
  tag: string;
  title: string;
  subtitle: string;
  icon?: keyof typeof Ionicons.glyphMap;
  gradient?: [string, string];
};

const SLIDES: Slide[] = [
  {
    id: "live",
    tag: "LIVE TRACKING",
    title: "Order · Dispatch · Track · Deliver",
    subtitle: "Real-time visibility on every transit mixer",
  },
  {
    id: "order",
    tag: "QUICK ORDER",
    title: "Order Concrete",
    subtitle: "Premium mixes delivered to your site, on time",
    icon: "cube-outline",
    gradient: ["#FF7A18", "#D65700"],
  },
  {
    id: "plants",
    tag: "DISCOVER",
    title: "Nearby RMC Plants",
    subtitle: "Find approved plants around your project",
    icon: "business-outline",
    gradient: ["#232B36", "#0E1116"],
  },
  {
    id: "challan",
    tag: "PAPERLESS",
    title: "Digital Challan",
    subtitle: "Delivery records when you need them",
    icon: "document-text-outline",
    gradient: ["#F26B1D", "#8F3B04"],
  },
];

export function CustomerHeroCarousel({ onAction }: { onAction?: (id: Slide["id"]) => void }) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth - spacing.lg * 2, 720);
  const height = Math.round(width * 0.56);
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const pausedRef = useRef(false);

  const goTo = useCallback((next: number, animated = true) => {
    scrollRef.current?.scrollTo({ x: next * width, animated });
  }, [width]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current) return;
      goTo((indexRef.current + 1) % SLIDES.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [goTo]);

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    indexRef.current = next;
    setIndex(next);
  };

  return (
    <View style={styles.outer}>
      <View style={[styles.wrap, { width, height, backgroundColor: colors.surfaceTertiary, shadowColor: colors.shadow }]}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => { pausedRef.current = true; }}
          onScrollEndDrag={() => { pausedRef.current = false; }}
          onTouchStart={() => { pausedRef.current = true; }}
          onTouchEnd={() => { pausedRef.current = false; }}
          onMomentumScrollEnd={onMomentumEnd}
          scrollEventThrottle={16}
        >
          {SLIDES.map((slide) => (
            <Pressable
              key={slide.id}
              testID={`home-hero-${slide.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${slide.title}. ${slide.subtitle}`}
              onPress={() => onAction?.(slide.id)}
              style={{ width, height }}
            >
              {slide.id === "live" ? (
                <Image
                  source={colors.isDark ? HERO_DARK : HERO_LIGHT}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  contentPosition="center"
                  cachePolicy="memory-disk"
                />
              ) : (
                <LinearGradient colors={slide.gradient!} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              )}

              {slide.icon ? (
                <Ionicons name={slide.icon} size={84} color="rgba(255,255,255,0.20)" style={styles.artIcon} />
              ) : null}

              <LinearGradient
                colors={["transparent", "rgba(8,10,14,0.12)", "rgba(8,10,14,0.88)"]}
                locations={[0, 0.42, 1]}
                style={StyleSheet.absoluteFill}
              />

              <View style={styles.copy}>
                <View style={styles.tag}>
                  <View style={styles.tagDot} />
                  <AppText style={styles.tagText}>{slide.tag}</AppText>
                </View>
                <AppText numberOfLines={2} style={styles.title}>{slide.title}</AppText>
                <AppText numberOfLines={1} style={styles.subtitle}>{slide.subtitle}</AppText>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.dots} pointerEvents="box-none">
          {SLIDES.map((slide, dotIndex) => (
            <Pressable
              key={slide.id}
              testID={`home-hero-dot-${dotIndex}`}
              hitSlop={8}
              onPress={() => {
                goTo(dotIndex);
                indexRef.current = dotIndex;
                setIndex(dotIndex);
              }}
            >
              <View style={[styles.dot, { width: dotIndex === index ? 22 : 7, opacity: dotIndex === index ? 1 : 0.5 }]} />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { alignItems: "center" },
  wrap: {
    borderRadius: radius.lg,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
  artIcon: { position: "absolute", right: -4, top: -6 },
  copy: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg + 14 },
  tag: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,106,0,0.92)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: spacing.sm,
  },
  tagDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#FFFFFF", marginRight: 5 },
  tagText: { color: "#FFFFFF", fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1 },
  title: { color: "#FFFFFF", fontFamily: fonts.displayBold, fontSize: fontSize.xl, lineHeight: 26 },
  subtitle: { color: "rgba(255,255,255,0.86)", fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: 2 },
  dots: { position: "absolute", right: spacing.lg, bottom: spacing.md, flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { height: 7, borderRadius: 4, backgroundColor: "#FFFFFF" },
});
