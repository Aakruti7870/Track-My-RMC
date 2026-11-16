import { useId } from "react";
import { View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { useTheme } from "@/src/theme/ThemeProvider";
import { cardHighlight } from "@/src/theme/tokens";

const highlightStops = [0, 0.15, 0.46, 1];

export function CardHighlight({ radius }: { radius: number }) {
  const { colors } = useTheme();
  const id = useId();
  const palette = colors.isDark ? cardHighlight.dark : cardHighlight.light;

  return (
    <View pointerEvents="none" aria-hidden accessible={false}
      style={{ position: "absolute", top: 1, left: 1, width: "58%", height: 42,
        borderTopLeftRadius: Math.max(0, radius - 1), overflow: "hidden" }}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="0%" cy="0%" rx="100%" ry="100%">
            {palette.map((color, index) => (
              <Stop key={color} offset={highlightStops[index]} stopColor={color.slice(0, 7)}
                stopOpacity={parseInt(color.slice(7), 16) / 255} />
            ))}
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
