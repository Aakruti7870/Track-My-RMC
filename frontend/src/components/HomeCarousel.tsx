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
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme/ThemeProvider";
import { AppText } from "@/src/components/ui/AppText";
import { IndiaServiceMap } from "@/src/components/promo/IndiaServiceMap";
import { fonts, radius } from "@/src/theme/tokens";

const HERO_LIGHT = require("../../assets/images/home-hero-light.jpg");
const HERO_DARK = require("../../assets/images/home-hero-dark.jpg");

const ORANGE = "#FF5A16";
const ORANGE_DEEP = "#C93D00";
const CASHFREE_GREEN = "#05B37E";
const CASHFREE_INK = "#111827";
const DIGI_BLUE = "#2F80ED";
const DIGI_SAFFRON = "#FF9933";

const AUTO_MS = 4500;
const SLIDE_COUNT = 4;
const MAX_WIDTH = 720;

type SlideProps = { width: number; height: number };

/** Compact Track My RMC wordmark used consistently across every promo slide. */
function BrandMark({ dark, scale = 1 }: { dark?: boolean; scale?: number }) {
  const fg = dark ? "#FFFFFF" : "#111315";
  return (
    <View style={styles.brandRow}>
      <View style={[styles.brandCube, { width: 18 * scale, height: 18 * scale, borderRadius: 5 * scale }]}>
        <Ionicons name="cube" size={11 * scale} color="#FFFFFF" />
      </View>
      <View>
        <AppText style={{ fontFamily: fonts.bold, fontSize: 8 * scale, letterSpacing: 1, color: fg, lineHeight: 9 * scale }}>
          TRACK MY
        </AppText>
        <AppText style={{ fontFamily: fonts.displayBold, fontSize: 13 * scale, lineHeight: 14 * scale, color: ORANGE }}>
          RMC
        </AppText>
      </View>
    </View>
  );
}

function Pill({ label, bg, color, scale = 1 }: { label: string; bg: string; color: string; scale?: number }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg, paddingHorizontal: 9 * scale, paddingVertical: 3 * scale }]}>
      <AppText style={{ fontFamily: fonts.bold, fontSize: 8.5 * scale, letterSpacing: 0.8, color }}>{label}</AppText>
    </View>
  );
}

/** IMAGE 1 — existing theme-aware hero (unchanged). */
function HeroSlide({ width, height }: SlideProps) {
  const { colors } = useTheme();
  return (
    <View style={{ width, height, backgroundColor: colors.isDark ? "#080A0C" : "#F7F8F6" }}>
      <Image
        source={colors.isDark ? HERO_DARK : HERO_LIGHT}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        contentPosition="center"
        priority="high"
        cachePolicy="memory-disk"
        transition={0}
      />
    </View>
  );
}

/** IMAGE 2 — Cashfree Payments Available (permanent light theme). */
function CashfreeSlide({ width, height }: SlideProps) {
  const scale = Math.min(Math.max(width / 390, 0.82), 1.5);
  return (
    <View style={{ width, height, backgroundColor: "#F5F7FA", padding: 16 * scale, justifyContent: "space-between" }}>
      <LinearGradient
        colors={["#FFFFFF", "#EEF3F8"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.slideTop}>
        <BrandMark scale={scale} />
        <Pill label="PAYMENTS NOW LIVE" bg="rgba(5,179,126,0.12)" color={CASHFREE_GREEN} scale={scale} />
      </View>

      <View style={[styles.slideBody, { gap: 14 * scale }]}>
        <View style={{ flex: 1, gap: 4 * scale }}>
          <AppText style={{ fontFamily: fonts.bold, fontSize: 22 * scale, lineHeight: 25 * scale, color: CASHFREE_INK }}>
            <AppText style={{ fontFamily: fonts.bold, fontSize: 22 * scale, lineHeight: 25 * scale, color: CASHFREE_GREEN }}>Cashfree</AppText> Payments
          </AppText>
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 12.5 * scale, lineHeight: 17 * scale, color: "#4A5568" }}>
            Pay for your RMC orders instantly & securely — UPI, cards, netbanking & wallets.
          </AppText>
        </View>

        <View style={[styles.cashfreeCard, { padding: 12 * scale, borderRadius: 14 * scale }]}>
          <View style={styles.brandRow}>
            <View style={[styles.cfDot, { backgroundColor: CASHFREE_GREEN }]} />
            <AppText style={{ fontFamily: fonts.displayBold, fontSize: 15 * scale, color: CASHFREE_INK }}>
              Cashfree
            </AppText>
          </View>
          <View style={[styles.payIcons, { marginTop: 8 * scale }]}>
            <View style={[styles.payChip, { backgroundColor: "rgba(5,179,126,0.12)" }]}>
              <Ionicons name="phone-portrait-outline" size={13 * scale} color={CASHFREE_GREEN} />
            </View>
            <View style={[styles.payChip, { backgroundColor: "rgba(17,24,39,0.06)" }]}>
              <Ionicons name="card-outline" size={13 * scale} color={CASHFREE_INK} />
            </View>
            <View style={[styles.payChip, { backgroundColor: "rgba(255,90,22,0.12)" }]}>
              <Ionicons name="wallet-outline" size={13 * scale} color={ORANGE} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

/** IMAGE 3 — KYC Mandatory via DigiLocker (permanent dark theme). */
function KycSlide({ width, height }: SlideProps) {
  const scale = Math.min(Math.max(width / 390, 0.82), 1.5);
  return (
    <View style={{ width, height, backgroundColor: "#0B0F14", padding: 16 * scale, justifyContent: "space-between" }}>
      <LinearGradient
        colors={["#111827", "#0B0F14"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.slideTop}>
        <BrandMark dark scale={scale} />
        <Pill label="KYC MANDATORY" bg="rgba(255,90,22,0.18)" color={ORANGE} scale={scale} />
      </View>

      <View style={[styles.slideBody, { gap: 14 * scale }]}>
        <View style={{ flex: 1, gap: 4 * scale }}>
          <AppText style={{ fontFamily: fonts.bold, fontSize: 22 * scale, lineHeight: 25 * scale, color: "#FFFFFF" }}>
            Complete your KYC
          </AppText>
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 12.5 * scale, lineHeight: 17 * scale, color: "#AEB8C4" }}>
            Verify instantly with DigiLocker to unlock ordering. Government-backed, paperless & secure.
          </AppText>
        </View>

        <View style={[styles.digiCard, { padding: 12 * scale, borderRadius: 14 * scale }]}>
          <View style={[styles.digiIcon, { backgroundColor: "rgba(47,128,237,0.16)" }]}>
            <Ionicons name="shield-checkmark" size={20 * scale} color={DIGI_BLUE} />
          </View>
          <AppText style={{ fontFamily: fonts.displayBold, fontSize: 15 * scale, marginTop: 8 * scale }}>
            <AppText style={{ fontFamily: fonts.displayBold, fontSize: 15 * scale, color: DIGI_BLUE }}>Digi</AppText>
            <AppText style={{ fontFamily: fonts.displayBold, fontSize: 15 * scale, color: DIGI_SAFFRON }}>Locker</AppText>
          </AppText>
        </View>
      </View>
    </View>
  );
}

/** IMAGE 4 — India service availability: Maharashtra, Goa, Karnataka (permanent light theme). */
function IndiaSlide({ width, height }: SlideProps) {
  const scale = Math.min(Math.max(width / 390, 0.82), 1.5);
  const mapHeight = Math.min(height - 40 * scale, height * 0.82);
  return (
    <View style={{ width, height, backgroundColor: "#F5F7FA", padding: 16 * scale, justifyContent: "space-between" }}>
      <LinearGradient
        colors={["#FFFFFF", "#EDF1F6"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.slideTop}>
        <BrandMark scale={scale} />
        <Pill label="NOW SERVICEABLE" bg="rgba(255,90,22,0.12)" color={ORANGE_DEEP} scale={scale} />
      </View>

      <View style={[styles.slideBody, { gap: 12 * scale }]}>
        <View style={{ flex: 1, gap: 5 * scale }}>
          <AppText style={{ fontFamily: fonts.bold, fontSize: 21 * scale, lineHeight: 24 * scale, color: "#111315" }}>
            Now serving across India
          </AppText>
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 12.5 * scale, lineHeight: 17 * scale, color: "#4A5568" }}>
            Track My RMC is live in Maharashtra, Goa & Karnataka.
          </AppText>
          <View style={[styles.legendRow, { marginTop: 4 * scale }]}>
            <View style={[styles.legendDot, { backgroundColor: ORANGE }]} />
            <AppText style={{ fontFamily: fonts.bold, fontSize: 10.5 * scale, color: "#111315" }}>
              Maharashtra · Goa · Karnataka
            </AppText>
          </View>
        </View>

        <View style={{ alignItems: "center", justifyContent: "center" }}>
          <IndiaServiceMap height={mapHeight} highlight={ORANGE} highlightStroke={ORANGE_DEEP} />
        </View>
      </View>
    </View>
  );
}

type Props = { style?: ViewStyle };

/**
 * Post-login top carousel: 4 auto-advancing slides. Image 1 is the existing
 * theme-aware hero. Images 2/3/4 are brand promo banners with permanent
 * light/dark/light themes. Supports auto-slide, manual swipe and dot paging.
 */
export function HomeCarousel({ style }: Props) {
  const { colors } = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const interactingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (Math.abs(prev.w - width) > 0.5 || Math.abs(prev.h - height) > 0.5 ? { w: width, h: height } : prev));
  }, []);

  // Keep current slide aligned when the container is (re)sized.
  useEffect(() => {
    if (size.w > 0) {
      scrollRef.current?.scrollTo({ x: indexRef.current * size.w, animated: false });
    }
  }, [size.w]);

  // Auto-advance.
  useEffect(() => {
    if (size.w <= 0) return;
    const id = setInterval(() => {
      if (interactingRef.current) return;
      const next = (indexRef.current + 1) % SLIDE_COUNT;
      indexRef.current = next;
      setIndex(next);
      scrollRef.current?.scrollTo({ x: next * size.w, animated: true });
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [size.w]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (size.w <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / size.w);
    if (i !== indexRef.current && i >= 0 && i < SLIDE_COUNT) {
      indexRef.current = i;
      setIndex(i);
    }
  }, [size.w]);

  const { w, h } = size;

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.wrap,
        { borderColor: colors.border, backgroundColor: colors.isDark ? "#080A0C" : "#F7F8F6" },
        style,
      ]}
    >
      {w > 0 && h > 0 ? (
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
            <HeroSlide width={w} height={h} />
            <CashfreeSlide width={w} height={h} />
            <KycSlide width={w} height={h} />
            <IndiaSlide width={w} height={h} />
          </ScrollView>

          <View style={styles.dots} pointerEvents="none">
            {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === index
                    ? { width: 18, backgroundColor: ORANGE }
                    : { width: 6, backgroundColor: "rgba(148,163,184,0.55)" },
                ]}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
    aspectRatio: 16 / 9,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  brandCube: { backgroundColor: ORANGE, alignItems: "center", justifyContent: "center" },
  pill: { borderRadius: 999, alignSelf: "flex-start" },
  slideTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  slideBody: { flexDirection: "row", alignItems: "flex-end", flex: 1, paddingTop: 8 },
  cashfreeCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cfDot: { width: 12, height: 12, borderRadius: 6 },
  payIcons: { flexDirection: "row", gap: 6 },
  payChip: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  digiCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  digiIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  dots: {
    position: "absolute",
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
  },
  dot: { height: 6, borderRadius: 3 },
});
