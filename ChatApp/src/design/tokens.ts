// Nexora monochrome design language.
// Single source of truth — every screen reads from here, so a token change
// propagates app-wide. Echoes the black/white login brand surface.

export const colors = {
  // Surfaces
  background: "#F4F4F5",
  surface: "#FFFFFF",
  surfaceAlt: "#FAFAFB",
  surfaceMuted: "#F1F1F3",
  surfaceElevated: "#FFFFFF",
  surfaceInverse: "#0A0A0A",
  surfaceInverseAlt: "#18181B",

  // Lines
  border: "#E4E4E7",
  borderStrong: "#D0D0D5",
  borderFaint: "#EDEDF0",
  divider: "#EDEDF0",

  // Text
  text: "#0A0A0A",
  textSecondary: "#52525B",
  textTertiary: "#8A8A93",
  textMuted: "#9A9AA3",
  textInverse: "#FFFFFF",
  textInverseMuted: "rgba(255,255,255,0.6)",

  // Primary action = ink black
  primary: "#0A0A0A",
  primaryPressed: "#262626",
  primaryMuted: "#F1F1F3",
  onPrimary: "#FFFFFF",

  // Focus / accent
  focus: "#0A0A0A",

  // Brand gradients (ink ramp for the "N" mark, brand surfaces, fills)
  gradient: {
    inkStart: "#1C1C1F",
    inkEnd: "#000000",
    inkSoftStart: "#2A2A2E",
    inkSoftEnd: "#0A0A0A",
    lightStart: "#FFFFFF",
    lightEnd: "#F1F1F3",
    overlayStart: "rgba(10,10,10,0.04)",
    overlayEnd: "rgba(10,10,10,0)",
  },

  // Feedback (kept restrained, desaturated)
  success: "#15803D",
  successMuted: "#ECFDF3",
  warning: "#B45309",
  warningMuted: "#FEF6EE",
  danger: "#B42318",
  dangerMuted: "#FEF3F2",

  // Shimmer for skeletons (kept as plain colors so non-Animated surfaces can use them)
  shimmerBase: "#EDEDF0",
  shimmerHighlight: "#FFFFFF",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 28,
  pill: 999,
};

// Soft, low-contrast elevation. Spread as style props.
export const shadow = {
  none: {},
  xs: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1.5,
  },
  md: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
  },
  lg: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 6,
  },
  xl: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.16,
    shadowRadius: 40,
    elevation: 10,
  },
  // Inner depth for the ink brand mark (no elevation, Android ignores inset).
  inset: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  // Soft glow used behind the active state and the N mark (ink tint).
  glow: {
    shadowColor: "#0A0A0A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 8,
  },
};

// Spring presets for Reanimated — tuned for a "premium, iOS-like" feel on
// Android. Damping-heavy so it never feels bouncy or cheap.
export const motion = {
  spring: {
    // Default press / selection — snappy, slightly underdamped.
    responsive: { stiffness: 420, damping: 32, mass: 0.9 },
    // Card / list entrance — softer settle.
    gentle: { stiffness: 120, damping: 18, mass: 1 },
    // Tab / pill selection — quick pop.
    snappy: { stiffness: 520, damping: 26, mass: 0.8 },
  },
  // Stagger delays (ms) for sequenced entrances.
  stagger: {
    fast: 60,
    normal: 90,
    slow: 120,
  },
  duration: {
    fade: 320,
    entrance: 560,
  },
};

export const typography = {
  display: {
    fontSize: 32,
    fontWeight: "800" as const,
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  displayLg: {
    fontSize: 44,
    fontWeight: "800" as const,
    letterSpacing: -0.8,
    lineHeight: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: "700" as const,
    letterSpacing: -0.3,
    lineHeight: 30,
  },
  heading: {
    fontSize: 17,
    fontWeight: "700" as const,
    letterSpacing: -0.2,
    lineHeight: 23,
  },
  body: {
    fontSize: 15,
    fontWeight: "400" as const,
    letterSpacing: 0,
    lineHeight: 22,
  },
  bodyStrong: {
    fontSize: 15,
    fontWeight: "600" as const,
    letterSpacing: 0,
    lineHeight: 22,
  },
  caption: {
    fontSize: 12,
    fontWeight: "400" as const,
    letterSpacing: 0,
    lineHeight: 17,
  },
  label: {
    fontSize: 13,
    fontWeight: "600" as const,
    letterSpacing: 0,
    lineHeight: 18,
  },
  overline: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    lineHeight: 14,
  },
};
