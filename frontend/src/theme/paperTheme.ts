import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from "react-native-paper";

import { fonts, palette, type ThemeColors } from "./tokens";

export function createPaperTheme(colors: ThemeColors, reduceMotion: boolean): MD3Theme {
  const base = colors.isDark ? MD3DarkTheme : MD3LightTheme;
  const surface = colors.isDark ? palette.graphiteSoft : palette.paper;
  const raised = colors.isDark ? palette.graphiteRaised : palette.mist;
  const background = colors.isDark ? palette.graphite : palette.warmWhite;
  const accent = colors.isDark ? palette.orange : colors.accentText;
  const onAccent = colors.isDark ? palette.graphite : palette.paper;
  const paperFonts = { ...base.fonts };

  for (const variant of Object.keys(paperFonts) as (keyof typeof paperFonts)[]) {
    if (variant === "default") continue;
    const style = base.fonts[variant];
    paperFonts[variant] = {
      ...style,
      fontFamily: style.fontWeight === "500" ? fonts.medium : fonts.regular,
      fontWeight: "normal",
    };
  }

  paperFonts.default = { ...base.fonts.default, fontFamily: fonts.regular, fontWeight: "normal" };

  return {
    ...base,
    fonts: paperFonts,
    roundness: 4,
    animation: { scale: reduceMotion ? 0 : 1 },
    colors: {
      ...base.colors,
      primary: accent,
      onPrimary: onAccent,
      primaryContainer: colors.isDark ? palette.orangeSoftDark : palette.orangeSoftStrong,
      onPrimaryContainer: colors.isDark ? "#FFB47D" : "#743000",
      secondary: colors.onSurfaceTertiary,
      onSecondary: surface,
      secondaryContainer: raised,
      onSecondaryContainer: colors.onSurface,
      tertiary: colors.onSurfaceTertiary,
      onTertiary: surface,
      tertiaryContainer: raised,
      onTertiaryContainer: colors.onSurface,
      background,
      onBackground: colors.onSurface,
      surface,
      onSurface: colors.onSurface,
      surfaceVariant: raised,
      onSurfaceVariant: colors.onSurfaceTertiary,
      surfaceDisabled: colors.disabledSurface,
      onSurfaceDisabled: colors.disabledContent,
      inverseSurface: colors.surfaceInverse,
      inverseOnSurface: colors.onSurfaceInverse,
      inversePrimary: colors.isDark ? "#A43D00" : palette.orange,
      outline: colors.controlOutline,
      outlineVariant: colors.divider,
      error: colors.isDark ? "#FF9997" : colors.error,
      onError: colors.isDark ? palette.graphite : palette.paper,
      errorContainer: colors.errorSoft,
      onErrorContainer: colors.isDark ? "#FFC9C6" : colors.error,
      shadow: colors.shadow,
      scrim: palette.black,
      backdrop: colors.scrim,
      elevation: {
        level0: "transparent",
        level1: surface,
        level2: raised,
        level3: raised,
        level4: raised,
        level5: raised,
      },
    },
  };
}
