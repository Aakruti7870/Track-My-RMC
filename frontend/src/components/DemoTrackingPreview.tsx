import React from "react";
import { View } from "react-native";
import Svg, { Rect, Path, Circle, G } from "react-native-svg";
import { AppText } from "./ui/AppText";
import { trackingCardStrings as t } from "@/src/tracking/homeTracking";
/** Original schematic artwork; no Google tiles or real GPS coordinates. */
export function DemoTrackingPreview() {
  return <View testID="demo-tracking-map" accessibilityLabel="Demonstration route and Transit Mixer illustration" style={{ width: "100%", aspectRatio: 2, backgroundColor: "#EEF1F0", overflow: "hidden" }}>
    <Svg width="100%" height="100%" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">
      <Rect width="800" height="400" fill="#EEF1F0" />
      <Rect x="678" y="270" width="110" height="85" rx="8" fill="#C6E5CD" />
      <Rect x="34" y="80" width="100" height="65" rx="7" fill="#F8EED1" />
      {[20,13].map(size => <G key={size} stroke={size === 20 ? "#D7DCDA" : "#FFF"} strokeWidth={size} fill="none"><Path d="M-40 300L250 -30M80 440L460 -30M290 440L650 -30M550 440L830 80M-20 85L650 440M-10 225L390 440M200 -10L810 330M450 -10L820 190M20 365L800 365" /></G>)}
      <Path d="M265 190Q320 215 345 190T420 163L458 112L552 192L575 187L548 230L630 308Q660 331 675 300L737 192L751 190L751 156" stroke="#F48A1F" strokeWidth="6" fill="none" strokeLinejoin="round" />
      <Circle cx="751" cy="156" r="10" fill="#F17D0B" stroke="#FFF" strokeWidth="4" />
      <G transform="translate(240 165)">
        <Path d="M0 20L63 20L63 -1L83 -1L94 20L94 30L0 30Z" fill="#263440" />
        <Path d="M66 2L80 2L88 16L66 16Z" fill="#A2D2E6" />
        <Path d="M4 -5Q22 -22 52 -7L62 7L49 24L16 18Z" fill="#F58C23" stroke="#CD7016" strokeWidth="2" />
        <Path d="M22 -13L37 21M39 -12L53 18" stroke="#FFBA60" strokeWidth="7" />
        {[17,41,81].map(x => <G key={x}><Circle cx={x} cy="30" r="9" fill="#24313C" /><Circle cx={x} cy="30" r="4" fill="#CBD5DB" /></G>)}
      </G>
    </Svg>
    <View style={{ position: "absolute", left: "23%", top: "20%", backgroundColor: "white", borderRadius: 10, padding: 7 }}><AppText style={{ fontSize: 11, lineHeight: 14, color: "#152238", textAlign: "center" }}>{t.vehicle}{"\n"}TM-08 {t.enRoute}</AppText></View>
    <View style={{ position: "absolute", bottom: 5, left: 8, backgroundColor: "#FFFFFFEE", paddingHorizontal: 5 }}><AppText style={{ fontSize: 10, color: "#475569" }}>{t.demo}</AppText></View>
  </View>;
}
