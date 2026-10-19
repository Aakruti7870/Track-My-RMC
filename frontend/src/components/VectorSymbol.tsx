import React from "react";
import { SvgXml } from "react-native-svg";
import { set0 } from "./vector-symbols/set0";
import { set1 } from "./vector-symbols/set1";
import { set2 } from "./vector-symbols/set2";
import { set3 } from "./vector-symbols/set3";
import { set4 } from "./vector-symbols/set4";
import { set5 } from "./vector-symbols/set5";
import { set6 } from "./vector-symbols/set6";
import { set7 } from "./vector-symbols/set7";
import { set8 } from "./vector-symbols/set8";

/**
 * The library of 91 checked-in SVG vector symbols (88 original + 3 Other Services).
 * Each master lives in frontend/assets/images/SVG Vector Symbol/.
 * The embedded XML works with Expo Metro on Android and web without a
 * custom SVG transformer. Keep each generated set in sync with its masters.
 */
const symbols = {
  ...set0,
  ...set1,
  ...set2,
  ...set3,
  ...set4,
  ...set5,
  ...set6,
  ...set7,
  ...set8,
} as const;

export type VectorSymbolName = keyof typeof symbols;

/** Decorative artwork; its surrounding control provides the accessible label. */
export function VectorSymbol({ name, size = 32, warmAccent = false }: { name: VectorSymbolName; size?: number; warmAccent?: boolean }) {
  // Owner-only recoloring preserves the uploaded geometry and other role artwork.
  const xml = warmAccent ? symbols[name].replace(/#(?:A78BFA|7C3AED|8B5CF6|C4B5FD|DDD6FE|6D28D9|9333EA|A855F7)/gi, color => ({ "#A78BFA": "#FBBF24", "#C4B5FD": "#FDE68A", "#DDD6FE": "#FFF2D6" }[color.toUpperCase()] ?? "#D97706")) : symbols[name];
  return <SvgXml xml={xml} width={size} height={size} />;
}
