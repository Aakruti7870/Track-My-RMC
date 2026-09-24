// Track My RMC final UI/UX tokens.
// Locked visual source: orange/saffron actions, warm light surfaces, graphite/black dark surfaces.
// Green is reserved for positive/verified states; do not use blue/indigo as an application accent.

export const palette = {
  orange: "#FF6A00",
  orangeBright: "#FF7A18",
  orangeDeep: "#D65700",
  orangePressed: "#C84F00",
  orangeSoft: "#FFF0E6",
  orangeSoftStrong: "#FFE1CC",
  orangeSoftDark: "#2C170A",
  graphite: "#0E1116",
  graphiteSoft: "#14181F",
  graphiteRaised: "#1D232D",
  warmWhite: "#F7F8F9",
  paper: "#FFFFFF",
  mist: "#F1F3F5",
  mistStrong: "#E2E8F0",
  // Compatibility names retained for older imports. They intentionally resolve to graphite, not navy.
  navy: "#0E1116",
  navySoft: "#14181F",
  navyRaised: "#1D232D",
  verified: "#38A169",
  verifiedDark: "#276749",
  verifiedSoft: "#E6F4EA",
  amber: "#DD6B20",
  amberDark: "#C05621",
  error: "#E53E3E",
  errorDark: "#9B2C2C",
  errorSoft: "#FDECEC",
  white: "#FFFFFF",
  black: "#050608",

  // Legacy aliases deliberately point to the locked orange system.
  emerald: "#FF6A00",
  emeraldBright: "#FF7A18",
  emeraldDeep: "#D65700",
  emeraldSoft: "#FFF0E6",
  emeraldSoftDark: "#2C170A",
  saffron: "#FF6A00",
  saffronSoft: "#FFF0E6",
  lime: "#FF6A00",
  limeDark: "#D65700",
  limeSoft: "#FFF0E6",
  limeTintDark: "#2C170A",
  limeTintDarker: "#40220E",
  success: "#38A169",
  successDark: "#276749",
  warning: "#DD6B20",
};

export type ThemeColors = {
  surface: string;
  onSurface: string;
  surfaceSecondary: string;
  onSurfaceSecondary: string;
  surfaceTertiary: string;
  onSurfaceTertiary: string;
  surfaceElevated: string;
  surfaceInverse: string;
  onSurfaceInverse: string;
  brand: string;
  brandPressed: string;
  onBrand: string;
  brandSoft: string;
  onBrandSoft: string;
  success: string;
  verified: string;
  verifiedSoft: string;
  warning: string;
  error: string;
  errorSoft: string;
  border: string;
  borderStrong: string;
  divider: string;
  focusRing: string;
  disabledSurface: string;
  disabledContent: string;
  scrim: string;
  shadow: string;
  glassTint: string;
  isDark: boolean;
};

export const darkColors: ThemeColors = {
  surface: "#0E1116",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#14181F",
  onSurfaceSecondary: "#F8FAFC",
  surfaceTertiary: "#1D232D",
  onSurfaceTertiary: "#A0AEC0",
  surfaceElevated: "#202731",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0E1116",
  brand: "#FF6A00",
  brandPressed: "#D65700",
  onBrand: "#FFFFFF",
  brandSoft: "#2C170A",
  onBrandSoft: "#FF8A33",
  success: "#38A169",
  verified: "#38A169",
  verifiedSoft: "#12251A",
  warning: "#DD6B20",
  error: "#E53E3E",
  errorSoft: "#35191B",
  border: "#2D3748",
  borderStrong: "#4A5568",
  divider: "#1A202C",
  focusRing: "rgba(255,106,0,0.30)",
  disabledSurface: "#242B35",
  disabledContent: "#68717F",
  scrim: "rgba(3,5,8,0.66)",
  shadow: "#000000",
  glassTint: "rgba(255,255,255,0.07)",
  isDark: true,
};

export const lightColors: ThemeColors = {
  surface: "#F7F8F9",
  onSurface: "#14181F",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#14181F",
  surfaceTertiary: "#F1F3F5",
  onSurfaceTertiary: "#4A5568",
  surfaceElevated: "#FFFFFF",
  surfaceInverse: "#0E1116",
  onSurfaceInverse: "#FFFFFF",
  brand: "#FF6A00",
  brandPressed: "#D65700",
  onBrand: "#FFFFFF",
  brandSoft: "#FFE1CC",
  onBrandSoft: "#D65700",
  success: "#276749",
  verified: "#276749",
  verifiedSoft: "#E6F4EA",
  warning: "#C05621",
  error: "#9B2C2C",
  errorSoft: "#FDECEC",
  border: "#E2E8F0",
  borderStrong: "#CBD5E0",
  divider: "#EDF2F7",
  focusRing: "rgba(255,106,0,0.20)",
  disabledSurface: "#ECEFF1",
  disabledContent: "#929AA3",
  scrim: "rgba(14,17,22,0.45)",
  shadow: "#0E1116",
  glassTint: "rgba(255,255,255,0.90)",
  isDark: false,
};

export const glass = {
  lightSurface: "rgba(255,255,255,0.92)",
  darkSurface: "rgba(20,24,31,0.94)",
  lightBorder: "rgba(20,24,31,0.08)",
  darkBorder: "rgba(255,255,255,0.10)",
  lightHighlight: "rgba(255,255,255,0.98)",
  darkHighlight: "rgba(255,255,255,0.07)",
  overlay: "rgba(14,17,22,0.48)",
};

export const aurora = {
  emerald: "rgba(255,106,0,0.14)",
  teal: "rgba(255,122,24,0.10)",
  saffron: "rgba(255,106,0,0.08)",
};

export const spacing = {
  "2xs": 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
  "4xl": 64,
};

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  "2xl": 38,
  pill: 999,
};

export const fonts = {
  display: "Outfit-SemiBold",
  displayBold: "Outfit-Bold",
  regular: "Jakarta-Regular",
  medium: "Jakarta-Medium",
  semibold: "Jakarta-SemiBold",
  bold: "Jakarta-Bold",
};

export const fontSize = {
  xs: 11,
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 38,
  "5xl": 46,
};

export const lineHeight = {
  tight: 1.12,
  title: 1.2,
  body: 1.5,
  relaxed: 1.65,
};

export const control = {
  minTouch: 44,
  inputHeight: 56,
  buttonHeight: 54,
  buttonHeightSmall: 44,
  buttonHeightLarge: 60,
  iconButton: 44,
};

export const layout = {
  screenGutter: 20,
  screenGutterCompact: 16,
  contentMax: 720,
  tabletMax: 960,
};

export const motion = {
  fast: 120,
  standard: 180,
  deliberate: 280,
};

export function statusColor(colors: ThemeColors, status?: string) {
  const s = (status || "").toUpperCase();
  if (["VERIFIED", "KYC_VERIFIED"].includes(s)) return colors.verified;
  if (["DELIVERED", "PAID", "ACTIVE", "APPROVED"].includes(s)) return colors.success;
  if (
    [
      "DISPATCHED", "EN_ROUTE", "AT_SITE", "UNLOADING", "IN_PRODUCTION",
      "LOADING", "READY_TO_DISPATCH", "TM_ASSIGNED", "DRIVER_ASSIGNED",
      "ACCEPTED", "SCHEDULED", "POD_PENDING", "PRODUCTION_COMPLETE",
    ].includes(s)
  ) return colors.brand;
  if (["PENDING", "DRAFT", "PARTIAL", "REQUIRES_REVERIFICATION"].includes(s)) return colors.warning;
  if (["CANCELLED", "REJECTED", "UNPAID", "NOT_STARTED", "SUSPENDED", "DECLINED"].includes(s)) return colors.error;
  return colors.onSurfaceTertiary;
}
