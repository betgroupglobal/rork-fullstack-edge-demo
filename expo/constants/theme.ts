import { Platform } from "react-native";

/**
 * Edge Gateway Dashboard theme — a dark developer-tool aesthetic with a single
 * electric-lime accent and monospace touches for technical readouts.
 */
export const theme = {
  colors: {
    bg: "#08090C",
    bgElevated: "#0E1014",
    surface: "#121620",
    surfaceAlt: "#171C28",
    border: "#222836",
    borderStrong: "#303749",
    text: "#EDF1F7",
    textDim: "#9AA4B6",
    textFaint: "#5C6679",
    accent: "#B8FF3C",
    accentDim: "#7FAE2C",
    accentGlow: "rgba(184,255,60,0.16)",
    cyan: "#46E0FF",
    danger: "#FF5C72",
    warn: "#FFB23E",
    ok: "#3CE08A",
  },
  radius: {
    sm: 10,
    md: 16,
    lg: 22,
    pill: 999,
  },
  spacing: (n: number): number => n * 4,
  font: {
    mono: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }) as string,
  },
} as const;

export type Theme = typeof theme;
