import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, type ComponentProps, type PropsWithChildren } from "react";
import { PaperProvider } from "react-native-paper";

import { createPaperTheme } from "./paperTheme";
import { useTheme } from "./ThemeProvider";

type IconRenderer = NonNullable<NonNullable<ComponentProps<typeof PaperProvider>["settings"]>["icon"]>;

const renderIcon: IconRenderer = ({ name, color, size, direction, testID }) => (
  <MaterialCommunityIcons
    name={name as keyof typeof MaterialCommunityIcons.glyphMap}
    color={color}
    size={size}
    testID={testID}
    importantForAccessibility="no"
    style={direction === "rtl" ? { transform: [{ scaleX: -1 }] } : undefined}
  />
);

const settings = { icon: renderIcon };

export function MaterialProvider({ children }: PropsWithChildren) {
  const { colors, reduceMotion } = useTheme();
  const theme = useMemo(() => createPaperTheme(colors, reduceMotion), [colors, reduceMotion]);
  return <PaperProvider theme={theme} settings={settings}>{children}</PaperProvider>;
}
