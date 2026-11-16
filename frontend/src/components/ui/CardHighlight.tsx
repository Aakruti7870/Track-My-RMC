import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "@/src/theme/ThemeProvider";
import { cardHighlight } from "@/src/theme/tokens";

export function CardHighlight({ radius }: { radius: number }) {
  const { colors } = useTheme();
  return (
    <LinearGradient pointerEvents="none" aria-hidden accessible={false}
      colors={colors.isDark ? cardHighlight.dark : cardHighlight.light}
      locations={[0, 0.15, 0.46, 1]} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 0.85 }}
      style={{ position: "absolute", top: 1, left: 1, width: "53%", height: 25,
        borderTopLeftRadius: Math.max(0, radius - 1), borderBottomRightRadius: 24 }} />
  );
}
