import React from "react";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "@/src/theme/ThemeProvider";
import { materialSymbolNames, materialSymbolPaths } from "./vector-symbols/materialSymbols";

import { homeShortcutPaths } from "./vector-symbols/homeShortcutPaths";

export type VectorSymbolName = keyof typeof materialSymbolNames;

type Props = {
  name: VectorSymbolName;
  size?: number;
  color?: string;
  outline?: boolean;
  outlineBackdrop?: string;
};

/** The surrounding control or status text supplies the accessible name. */
export function VectorSymbol({ name, size = 24, color, outline = false, outlineBackdrop }: Props) {
  const { colors } = useTheme();
  const ink = color ?? colors.onSurfaceTertiary;
  const outlinePath = outline ? (homeShortcutPaths as Partial<Record<VectorSymbolName, string>>)[name] : undefined;

  if (outlinePath) {
    return <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden accessible={false}
      importantForAccessibility="no-hide-descendants">
      {outlineBackdrop ? <Path d={outlinePath} fill="none" stroke={outlineBackdrop} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" /> : null}
      <Path d={outlinePath} fill="none" stroke={ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>;
  }

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {outlineBackdrop ? <Path d={materialSymbolPaths[materialSymbolNames[name]]} fill="none"
        stroke={outlineBackdrop} strokeWidth={70} strokeLinejoin="round" /> : null}
      <Path d={materialSymbolPaths[materialSymbolNames[name]]} fill={ink} />
    </Svg>
  );
}
