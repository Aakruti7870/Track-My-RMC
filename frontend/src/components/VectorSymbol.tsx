import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";

import { useTheme } from "@/src/theme/ThemeProvider";
import { materialSymbolNames, materialSymbolPaths } from "./vector-symbols/materialSymbols";
import trackIcons from "./vector-symbols/track-icons.json";

const aliases = {
  "billing-ledger": "billing-and-ledger",
  "employee-master-salary": "employee-master-and-salary",
  "premium-promotions": "premium-and-promotions",
  "production-dispatch": "production-and-dispatch",
  "project-site-hub": "project-and-site-hub",
  "receiving-quality-guide": "receiving-and-quality-guide",
} as const satisfies Record<string, keyof typeof trackIcons>;

export type VectorSymbolName = keyof typeof trackIcons | keyof typeof aliases | keyof typeof materialSymbolNames;

type Shape = [keyof typeof shapes, Record<string, string>, Shape[]?];
const shapes = { path: Path, circle: Circle, g: G, line: Line, rect: Rect };

function renderShapes(nodes: readonly Shape[]): React.JSX.Element[] {
  return nodes.map(([tag, props, children], index) => {
    const Shape = shapes[tag];
    return <Shape key={index} {...props}>{children ? renderShapes(children) : null}</Shape>;
  });
}

type Props = {
  name: VectorSymbolName;
  size?: number;
  color?: string;
  active?: boolean;
  variant?: "avatar-shield" | "browser-shield";
};

/** The surrounding control or status text supplies the accessible name. */
export function VectorSymbol({ name, size = 24, color, active, variant }: Props) {
  const { colors } = useTheme();
  const canonical = name in aliases ? aliases[name as keyof typeof aliases] : name;
  const art = (trackIcons as unknown as Partial<Record<VectorSymbolName, Record<string, Shape[]>>>)[canonical];
  const ink = color ?? (colors.isDark ? "#E4EEF0" : "#16232A");
  const selected = variant ?? (active ? "active" : name === "restricted-access" && size <= 24 ? "compact-lock" : undefined);
  const nodes = art && ((selected && art[selected]) || art[size <= 24 ? "compact" : "full"]);
  const fallback = materialSymbolNames[name as keyof typeof materialSymbolNames];

  return (
    <Svg width={size} height={size} viewBox={nodes ? "0 0 64 64" : "0 -960 960 960"}
      color={ink} fill="none" aria-hidden accessible={false} importantForAccessibility="no-hide-descendants">
      {nodes ? renderShapes(nodes) : fallback ? <Path d={materialSymbolPaths[fallback]} fill={ink} /> : null}
    </Svg>
  );
}
