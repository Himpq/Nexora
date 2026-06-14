// Nexora monochrome design language.
// Single source of truth — every screen reads from here, so a token change
// propagates app-wide. Echoes the black/white login brand surface.

export const colors = {
  // Surfaces
  background: "#F4F4F5",
  surface: "#FFFFFF",
  surfaceMuted: "#F1F1F3",
  surfaceInverse: "#000000",

  // Lines
  border: "#E4E4E7",
  borderStrong: "#D0D0D5",
  divider: "#EDEDF0",

  // Text
  text: "#0A0A0A",
  textSecondary: "#52525B",
  textMuted: "#9A9AA3",
  textInverse: "#FFFFFF",

  // Primary action = ink black
  primary: "#0A0A0A",
  primaryPressed: "#262626",
  primaryMuted: "#F1F1F3",
  onPrimary: "#FFFFFF",

  // Focus / accent
  focus: "#0A0A0A",

  // Feedback (kept restrained, desaturated)
  success: "#15803D",
  successMuted: "#ECFDF3",
  warning: "#B45309",
  warningMuted: "#FEF6EE",
  danger: "#B42318",
  dangerMuted: "#FEF3F2",
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
  pill: 999,
};

// Soft, low-contrast elevation. Spread as style props.
export const shadow = {
  none: {},
  sm: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  lg: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 4,
  },
};

export const typography = {
  display: {
    fontSize: 32,
    fontWeight: "800" as const,
    letterSpacing: -0.5,
    lineHeight: 38,
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
