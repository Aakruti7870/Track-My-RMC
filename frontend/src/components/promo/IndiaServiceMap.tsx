import React from "react";
import Svg, { Path } from "react-native-svg";

type StateShape = { id: string; name: string; path: string };
type IndiaData = { viewBox: string; states: StateShape[] };

// Accurate India state geometry (ISO 3166-2 ids). Bundled JSON, parsed once.
const INDIA = require("../../../assets/india-states.json") as IndiaData;

// Maharashtra (mh), Goa (ga), Karnataka (ka)
const HIGHLIGHT = new Set(["mh", "ga", "ka"]);

type Props = {
  height?: number;
  highlight?: string;
  highlightStroke?: string;
  base?: string;
  baseStroke?: string;
};

/**
 * Renders a geographically accurate map of India with only Maharashtra, Goa and
 * Karnataka highlighted. Pure vector (react-native-svg) so it never stretches,
 * crops or distorts at any resolution.
 */
export function IndiaServiceMap({
  height = 150,
  highlight = "#FF5A16",
  highlightStroke = "#C93D00",
  base = "#D7DBE1",
  baseStroke = "#C3C8D0",
}: Props) {
  const parts = INDIA.viewBox.split(/\s+/).map(Number);
  const vbW = parts[2] || 612;
  const vbH = parts[3] || 696;
  const width = Math.round(height * (vbW / vbH));

  return (
    <Svg width={width} height={height} viewBox={INDIA.viewBox}>
      {INDIA.states.map((s) => {
        const hi = HIGHLIGHT.has(s.id);
        return (
          <Path
            key={s.id}
            d={s.path}
            fill={hi ? highlight : base}
            stroke={hi ? highlightStroke : baseStroke}
            strokeWidth={hi ? 1.4 : 0.5}
            strokeLinejoin="round"
          />
        );
      })}
    </Svg>
  );
}
