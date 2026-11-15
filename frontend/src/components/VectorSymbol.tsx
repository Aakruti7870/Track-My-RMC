import React from "react";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "@/src/theme/ThemeProvider";
import { materialSymbolNames, materialSymbolPaths } from "./vector-symbols/materialSymbols";

export type VectorSymbolName = keyof typeof materialSymbolNames;

type Props = {
  name: VectorSymbolName;
  size?: number;
  color?: string;
};

/** The surrounding control or status text supplies the accessible name. */
export function VectorSymbol({ name, size = 24, color }: Props) {
  const { colors } = useTheme();

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={materialSymbolPaths[materialSymbolNames[name]]} fill={color ?? colors.onSurfaceTertiary} />
    </Svg>
  );
}
