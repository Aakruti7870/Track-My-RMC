import { Platform, type ViewStyle } from "react-native";
import type { ThemeColors } from "@/src/theme/tokens";

// On the web, clip scroll-view descendants without creating a second scroll box.
export const screenOverflow = Platform.OS === "web" ? ("clip" as ViewStyle["overflow"]) : "hidden";

/**
 * Navigation scene backgrounds must be fully opaque. Translucent navigation
 * scenes reveal other mounted routes (the Home carousel behind Plants/Orders).
 */
export function getThemedCanvasColor(colors: ThemeColors): string {
  return colors.canvas;
}

export function getThemedSceneStyle(colors: ThemeColors): ViewStyle {
  const backgroundColor = getThemedCanvasColor(colors);
  if (Platform.OS !== "web") return { backgroundColor };

  // Web: apply the same subdued wallpaper to each opaque navigation scene rather
  // than allowing prior route content to show through a transparent scene.
  const asset = colors.isDark
    ? require("../../assets/images/Background Dark Theme.webp")
    : require("../../assets/images/Background Light Theme.webp");
  // Metro's web asset modules expose a URL directly or in a { uri } object.
  // React Native Web's Image does NOT implement Image.resolveAssetSource.
  const source = asset as string | { uri?: string; default?: { uri?: string } };
  const uri = typeof source === "string" ? source : source?.uri ?? source?.default?.uri;
  if (!uri) return { backgroundColor };
  const veil = colors.isDark ? "rgba(7,8,13,0.85)" : "rgba(233,228,222,0.85)";
  return {
    backgroundColor,
    backgroundImage: `linear-gradient(${veil}, ${veil}), url("${uri}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  } as ViewStyle;
}
