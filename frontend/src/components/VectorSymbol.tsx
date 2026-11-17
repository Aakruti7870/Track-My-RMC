import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";

import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme/ThemeProvider";
import { materialSymbolNames, materialSymbolPaths } from "./vector-symbols/materialSymbols";
import generatedIcons from "./vector-symbols/generated-icons.json";
import trackIcons from "./vector-symbols/track-icons.json";

const aliases = {
  "billing-ledger": "billing-and-ledger",
  "employee-master-salary": "employee-master-and-salary",
  "premium-promotions": "premium-and-promotions",
  "production-dispatch": "production-and-dispatch",
  "project-site-hub": "project-and-site-hub",
  "receiving-quality-guide": "receiving-and-quality-guide",
} as const satisfies Record<string, keyof typeof trackIcons>;

export type VectorSymbolName = keyof typeof generatedIcons.symbols | keyof typeof trackIcons
  | keyof typeof aliases | keyof typeof materialSymbolNames;

type Shape = [keyof typeof shapes, Record<string, string>, Shape[]?];
const shapes = { path: Path, circle: Circle, ellipse: Ellipse, g: G, line: Line, rect: Rect };
const supplied = generatedIcons.symbols as unknown as Partial<Record<VectorSymbolName, Shape[]>>;
const customerOverrides = generatedIcons.customerOverrides as unknown as Partial<Record<VectorSymbolName, Shape[]>>;
const legacy = trackIcons as unknown as Partial<Record<VectorSymbolName, Record<string, Shape[]>>>;

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
  const { user } = useAuth();
  const canonical = name in aliases ? aliases[name as keyof typeof aliases] : name;
  const art = legacy[canonical];
  const ink = color ?? (colors.isDark ? "#E4EEF0" : "#16232A");
  const customer = user?.role === "customer";
  const selectedHome = customer && active && canonical === "home" ? "home-selected" : canonical;
  const specialVariant = variant ?? (canonical === "restricted-access" && size <= 24 ? "compact-lock" : undefined);
  const nodes = (specialVariant && art?.[specialVariant])
    || (customer && customerOverrides[selectedHome])
    || supplied[selectedHome]
    || (active && art?.active)
    || art?.[size <= 24 ? "compact" : "full"];
  const fallback = materialSymbolNames[name as keyof typeof materialSymbolNames];

  return (
    <Svg width={size} height={size} viewBox={nodes ? "0 0 64 64" : "0 -960 960 960"}
      color={ink} fill="none" aria-hidden accessible={false} importantForAccessibility="no-hide-descendants">
      {nodes ? renderShapes(nodes) : fallback ? <Path d={materialSymbolPaths[fallback]} fill={ink} /> : null}
    </Svg>
  );
}
