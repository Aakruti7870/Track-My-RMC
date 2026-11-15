// Track My RMC final UI/UX tokens.
// Login and home reference palette. Operational status colors are scoped to their UI.

export const palette = {
  orange: "#FF7800",
  orangeBright: "#FF8A18",
  orangeDeep: "#D65700",
  orangePressed: "#C84F00",
  orangeSoft: "#FFF0E6",
  orangeSoftStrong: "#FFE1CC",
  orangeSoftDark: "#2C170A",
  graphite: "#07080D",
  graphiteSoft: "#121212",
  graphiteRaised: "#1A1A1A",
  warmWhite: "#E9E4DE",
  paper: "#FAF9F5",
  mist: "#F0EDE6",
  mistStrong: "#D9D6CF",
  // Compatibility names retained for older imports. They intentionally resolve to graphite, not navy.
  navy: "#07080D",
  navySoft: "#121212",
  navyRaised: "#1A1A1A",
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
  emerald: "#FF7800",
  emeraldBright: "#FF8A18",
  emeraldDeep: "#D65700",
  emeraldSoft: "#FFF0E6",
  emeraldSoftDark: "#2C170A",
  saffron: "#FF7800",
  saffronSoft: "#FFF0E6",
  lime: "#FF7800",
  limeDark: "#D65700",
  limeSoft: "#FFF0E6",
  limeTintDark: "#2C170A",
  limeTintDarker: "#40220E",
  success: "#38A169",
  successDark: "#276749",
  warning: "#DD6B20",
};

export type ThemeColors = {
  canvas: string;
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
  canvas: "#07080D",
  surface: "rgba(7,8,13,0.52)",
  onSurface: "#FEFEFE",
  surfaceSecondary: "#121212",
  onSurfaceSecondary: "#E1E1E1",
  surfaceTertiary: "#1A1A1A",
  onSurfaceTertiary: "#A0A0A0",
  surfaceElevated: "#1C1C1C",
  surfaceInverse: "#FAF9F5",
  onSurfaceInverse: "#0A0907",
  brand: "#FF7800",
  brandPressed: "#E67500",
  onBrand: "#121212",
  accentText: "#E6A35C",
  controlOutline: "#707070",
  brandSoft: "#432A10",
  onBrandSoft: "#FFF0E2",
  success: "#4ADE80",
  verified: "#4ADE80",
  verifiedSoft: "#12251A",
  warning: "#DD6B20",
  error: "#FF7777",
  errorSoft: "#35191B",
  border: "#404040",
  borderStrong: "#616161",
  divider: "#363636",
  focusRing: "rgba(255,120,0,0.38)",
  disabledSurface: "#252525",
  disabledContent: "#A1A1A1",
  scrim: "rgba(3,5,8,0.66)",
  shadow: "#000000",
  isDark: true,
};

export const lightColors: ThemeColors = {
  canvas: "#E9E4DE",
  surface: "rgba(233,228,222,0.52)",
  onSurface: "#0A0907",
  surfaceSecondary: "#FAF9F5",
  onSurfaceSecondary: "#3C3C39",
  surfaceTertiary: "#F0EDE6",
  onSurfaceTertiary: "#504D47",
  surfaceElevated: "#FCFBF7",
  surfaceInverse: "#121212",
  onSurfaceInverse: "#FEFEFE",
  brand: "#FF8201",
  brandPressed: "#EA7000",
  onBrand: "#0A0907",
  accentText: "#8D5027",
  controlOutline: "#827C74",
  brandSoft: "#FDE9D0",
  onBrandSoft: "#5D3719",
  success: "#276749",
  verified: "#276749",
  verifiedSoft: "#E6F4EA",
  warning: "#C05621",
  error: "#9B2C2C",
  errorSoft: "#FDECEC",
  border: "#C9C4BE",
  borderStrong: "#B5AEA6",
  divider: "#D9D6CF",
  focusRing: "rgba(161,97,54,0.35)",
  disabledSurface: "#EAE7E0",
  disabledContent: "#65625B",
  scrim: "rgba(14,17,22,0.45)",
  shadow: "#685B4C",
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

export const homeArtwork = {
  copperEdge: ["#9D6930", "#815530"],
  quickFill: "rgba(255,120,0,0.50)",
  bulkSurface: ["#452D15", "#483019"],
  bulkIconFill: "rgba(34,197,94,0.70)",
  kycSurface: "rgba(99,52,250,0.18)",
  kycIconFill: "rgba(99,52,255,0.70)",
  positiveTint: "rgba(34,197,94,0.20)",
  positiveAction: "#166534",
  positivePressed: "#14532D",
} as const;

export const loginAppearance = {
  dark: {
    canvas: "#08090E", heroTop: "#151D2A", heroEdge: "#0D0D13",
    heroFade: ["#0D0D13", "#08090E", "#08090E"],
    card: ["rgba(34,33,31,0.94)", "rgba(24,24,23,0.96)", "rgba(32,32,31,0.94)"],
    cardHighlight: ["rgba(212,126,32,0.22)", "rgba(141,84,26,0.035)", "rgba(141,84,26,0)"],
    rim: ["#F1AE53", "#77746D", "#424240"],
    rail: "rgba(29,29,28,0.75)", railOutline: "#4C4945",
    tab: ["#684014", "#4A3014", "#352414"], tabOutline: "#A36620",
    selectedIcon: "#FFA32D", selectedText: "#FFF4E7", inactive: "#C1C1C1",
    iconSurface: "#503314", field: "rgba(255,255,255,0.035)", prefix: "rgba(8,8,8,0.20)",
    fieldOutline: "#71716E", placeholder: "#D9D9D6",
    disabledFill: "#2B2B2B", disabledGradient: ["#353534", "#30302F"], disabledText: "#A6A6A4",
    reviewerSurface: "rgba(255,255,255,0.025)", reviewer: "#35CE92",
    link: "#FFA233", privacy: "#FFA233", delete: "#F1A3A7",
  },
  light: {
    canvas: "#F4F1EC", heroTop: "#A0BACD", heroEdge: "#7B7A78",
    heroFade: ["#7B7A78", "#F4F1EC", "#F4F1EC"],
    card: ["rgba(253,250,244,0.98)", "rgba(248,246,241,0.98)", "rgba(254,253,249,0.98)"],
    cardHighlight: ["rgba(214,146,64,0.18)", "rgba(234,177,109,0.05)", "rgba(234,177,109,0)"],
    rim: ["#B57933", "#B8AA99", "#C7C0B7"],
    rail: "#F0EDE6", railOutline: "#BDB4A6",
    tab: ["#F8D3A6", "#FCE4C6", "#F8DFC1"], tabOutline: "#AD794C",
    selectedIcon: "#92511D", selectedText: "#5D3719", inactive: "#504D47",
    iconSurface: "#FAE5CD", field: "#FCFBF7", prefix: "#F4F1EB",
    fieldOutline: "#827C74", placeholder: "#4D4A44",
    disabledFill: "#ECE8E1", disabledGradient: ["#E9E5DD", "#F0ECE6"], disabledText: "#65625B",
    reviewerSurface: "#FCFBF7", reviewer: "#267158",
    link: "#864618", privacy: "#864618", delete: "#8D4852",
  },
} as const;

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
  quickSymbol: 24, quickIconBox: 44, quickTile: 80, quickLabel: 14, quickLabelLine: 18, quickLabelMin: 18,
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
  quickSymbol: 25, quickIconBox: 47, quickTile: 84, quickLabel: 15, quickLabelLine: 20, quickLabelMin: 20,
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
  quickSymbol: 28, quickIconBox: 52, quickTile: 88, quickLabel: 16, quickLabelLine: 20, quickLabelMin: 20,
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
