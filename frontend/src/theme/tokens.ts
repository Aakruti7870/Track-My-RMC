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
  accentText: string;
  controlOutline: string;
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
  isDark: boolean;
};

export const darkColors: ThemeColors = {
  surface: "rgba(14,17,22,0.52)",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#1A1F26",
  onSurfaceSecondary: "#F8FAFC",
  surfaceTertiary: "#262D38",
  onSurfaceTertiary: "#B8C1CC",
  surfaceElevated: "#20262E",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0E1116",
  brand: "#FF8A00",
  brandPressed: "#E67500",
  onBrand: "#0E1116",
  accentText: "#FFB47D",
  controlOutline: "#8793A2",
  brandSoft: "rgba(255,138,0,0.18)",
  onBrandSoft: "#FF9A3D",
  success: "#38A169",
  verified: "#38A169",
  verifiedSoft: "#12251A",
  warning: "#DD6B20",
  error: "#FF7777",
  errorSoft: "#35191B",
  border: "rgba(255,154,61,0.24)",
  borderStrong: "rgba(255,154,61,0.46)",
  divider: "rgba(184,193,204,0.18)",
  focusRing: "rgba(255,138,0,0.32)",
  disabledSurface: "rgba(148,163,184,0.34)",
  disabledContent: "#CBD5E1",
  scrim: "rgba(3,5,8,0.66)",
  shadow: "#000000",
  isDark: true,
};

export const lightColors: ThemeColors = {
  surface: "rgba(247,248,249,0.52)",
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
  onBrand: "#0E1116",
  accentText: "#A43D00",
  controlOutline: "#687384",
  brandSoft: "#FFE1CC",
  onBrandSoft: "#873B05",
  success: "#276749",
  verified: "#276749",
  verifiedSoft: "#E6F4EA",
  warning: "#C05621",
  error: "#9B2C2C",
  errorSoft: "#FDECEC",
  border: "#E2E8F0",
  borderStrong: "#CBD5E0",
  divider: "#E0E3E7",
  focusRing: "rgba(255,106,0,0.20)",
  disabledSurface: "#ECEFF1",
  disabledContent: "#929AA3",
  scrim: "rgba(14,17,22,0.45)",
  shadow: "#0E1116",
  isDark: false,
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

export const iconTile = { light: "#4A5568", dark: "#394454", foreground: "#FFFFFF" };
export const homeShortcutTile = {
  light: { background: "#DCE8F4", foreground: "#264C6A" },
  dark: { background: "#29465F", foreground: "#C7E3FF" },
};

export const fonts = {
  display: "Jakarta-SemiBold",
  displayBold: "Jakarta-Bold",
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
  buttonHeightSmall: 48,
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

export type OperationalStatus = "success" | "approval" | "warning" | "critical" | "neutral";
export const operationalPalette = {
  success: "#22C55E",
  approval: "#166534",
  warning: "#F59E0B",
  critical: "#EF4444",
} as const;

/** Severity is independent of brand styling and consistent between mobile roles. */
export function operationalStatus(status: OperationalStatus, dark = false): string {
  if (status === "neutral") return dark ? "#B8C1CC" : "#4A5568";
  if (status === "success" && !dark) return "#276749";
  if (status === "critical" && dark) return "#FF7777";
  if (status === "approval" && dark) return operationalPalette.success;
  if (status === "warning" && !dark) return "#92400E";
  if (status === "critical" && !dark) return "#B91C1C";
  return operationalPalette[status];
}

export function statusColor(colors: ThemeColors, status?: string) {
  const s = (status || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["APPROVED", "ACCEPTED", "CONFIRMED", "VERIFIED", "KYC_VERIFIED"].includes(s))
    return operationalStatus("approval", colors.isDark);
  if (["DELIVERED", "COMPLETED", "COMPLETE", "PAID", "ACTIVE", "RESOLVED",
       "AVAILABLE", "RECEIVED", "IN_STOCK", "SUCCESS", "PASSED"].includes(s))
    return operationalStatus("success", colors.isDark);
  if (["CRITICAL", "SOS", "EMERGENCY", "FAILED", "FAIL", "CANCELLED", "REJECTED",
       "DECLINED", "SUSPENDED", "OVERDUE", "EXPIRED", "OUT_OF_STOCK"].includes(s))
    return operationalStatus("critical", colors.isDark);
  if (["PENDING", "NEW", "OPEN", "DRAFT", "PARTIAL", "UNPAID", "LOW_STOCK",
       "RESPONDING", "ACKNOWLEDGED", "CONTACTED", "NEEDS_REVIEW",
       "REQUIRES_REVERIFICATION", "REVIEW_NEEDED", "DOCUMENT_NOT_SHARED",
       "DOCUMENT_UNAVAILABLE", "IN_PROGRESS", "WAITING", "REORDER", "WARNING"].includes(s))
    return operationalStatus("warning", colors.isDark);
  if (["QUOTED", "PRODUCTION_COMPLETE", "DISPATCHED", "EN_ROUTE", "AT_SITE",
       "UNLOADING", "IN_PRODUCTION", "LOADING", "READY_TO_DISPATCH", "TM_ASSIGNED",
       "DRIVER_ASSIGNED", "SCHEDULED", "POD_PENDING"].includes(s))
    return colors.brand;
  return colors.onSurfaceTertiary;
}


// Customer Home sizes shared by native and mobile web. Wider web layouts use a larger type scale.
// React Native layout units are dp on native and CSS px on web.
const customerHomeMobile = {
  sectionGap: 10, gridGap: 10, headerSize: 15, headerLine: 20,
  quickSymbol: 24, quickTile: 80, quickLabel: 14, quickLabelLine: 18, quickLabelMin: 18,
  toolSymbol: 24, toolTile: 76, toolLabel: 12, toolLabelLine: 16,
  serviceSymbol: 24, serviceTile: 76, serviceLabel: 12, serviceLabelLine: 15,
  kycSymbol: 28, kycArrow: 25, kycArrowIcon: 17, kycTitle: 15, kycTitleLine: 20,
  kycSubtitle: 12, kycSubtitleLine: 17, kycGap: 10, kycPadding: 6, kycRadius: 4,
  locationSize: 13, locationLine: 18, headerHeight: 52, headerTarget: 44,
  headerShield: 35, headerFlag: 22, headerChevron: 16, headerScan: 32,
  headerQR: 19, headerBell: 22, headerHelp: 24, headerVerified: 32,
} as const;

const customerHomeTablet = {
  ...customerHomeMobile,
  sectionGap: 12, gridGap: 12, headerSize: 16, headerLine: 22,
  quickSymbol: 24, quickTile: 84, quickLabel: 15, quickLabelLine: 20, quickLabelMin: 20,
  toolSymbol: 24, toolTile: 80, toolLabel: 13, toolLabelLine: 16,
  serviceSymbol: 24, serviceTile: 80, serviceLabel: 14, serviceLabelLine: 18,
  kycSymbol: 32, kycArrow: 28, kycArrowIcon: 19, kycTitle: 16, kycTitleLine: 22,
  kycSubtitle: 12, kycSubtitleLine: 18, kycGap: 12, kycPadding: 8, kycRadius: 8,
  locationSize: 14, locationLine: 20, headerHeight: 58, headerTarget: 48,
  headerShield: 40, headerFlag: 24, headerChevron: 18, headerScan: 36,
  headerQR: 22, headerBell: 24, headerHelp: 26, headerVerified: 36,
} as const;

const customerHomeDesktop = {
  ...customerHomeTablet,
  sectionGap: 16, gridGap: 16, headerSize: 18, headerLine: 24,
  quickSymbol: 28, quickTile: 88, quickLabel: 16, quickLabelLine: 20, quickLabelMin: 20,
  toolSymbol: 28, toolTile: 84, toolLabel: 14, toolLabelLine: 18,
  serviceSymbol: 28, serviceTile: 84, serviceLabel: 15, serviceLabelLine: 20,
  kycSymbol: 36, kycArrow: 32, kycArrowIcon: 21, kycTitle: 18, kycTitleLine: 24,
  kycSubtitle: 13, kycSubtitleLine: 19, kycGap: 14, kycPadding: 10, kycRadius: 10,
  locationSize: 15, locationLine: 22, headerHeight: 64, headerTarget: 52,
  headerShield: 44, headerFlag: 28, headerChevron: 20, headerScan: 40,
  headerQR: 24, headerBell: 26, headerHelp: 28, headerVerified: 40,
} as const;

export function customerHomeSizes(viewportWidth: number, platform: string) {
  // Breakpoints use the actual viewport width, not a device model or user agent.
  // Native tablets use the native sizing policy.
  if (platform !== "web" || viewportWidth < 600) return customerHomeMobile;
  if (viewportWidth < 1024) return customerHomeTablet;
  return customerHomeDesktop;
}
