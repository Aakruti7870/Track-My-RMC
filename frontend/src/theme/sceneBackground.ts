import { Platform, type ViewStyle } from "react-native";
import type { ThemeColors } from "@/src/theme/tokens";

/**
 * Navigation scene backgrounds must be fully opaque. Translucent navigation
 * scenes reveal other mounted routes (the Home carousel behind Plants/Orders).
 * Individual glass cards keep their own alpha surfaces.
 */
export function getThemedCanvasColor(colors: ThemeColors): string {
  return colors.isDark ? "#0E1116" : "#F7F8F9";
}

export function getThemedSceneStyle(colors: ThemeColors): ViewStyle {
  const backgroundColor = getThemedCanvasColor(colors);
  if (Platform.OS !== "web") return { backgroundColor };

  // Web: apply the same 35% wallpaper to each opaque navigation scene rather
  // than allowing prior route content to show through a transparent scene.
  const asset = colors.isDark
    ? require("../../assets/images/Background Dark Theme.png")
    : require("../../assets/images/Background Light Theme.png");
  // Metro's web asset modules expose a URL directly or in a { uri } object.
  // React Native Web's Image does NOT implement Image.resolveAssetSource.
  const source = asset as string | { uri?: string; default?: { uri?: string } };
  const uri = typeof source === "string" ? source : source?.uri ?? source?.default?.uri;
  if (!uri) return { backgroundColor };
  const veil = colors.isDark ? "rgba(14,17,22,0.65)" : "rgba(247,248,249,0.65)";
  return {
    backgroundColor,
    backgroundImage: `linear-gradient(${veil}, ${veil}), url("${uri}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  } as ViewStyle;
}
