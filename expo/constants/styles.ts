import { Platform, StyleSheet } from "react-native";
import { theme } from "./theme";

// ── Shared Style System ──
// Every screen imports these presets and composes with screen-specific overrides.
// Eliminates ~200+ lines of duplicated StyleSheet code across 5 tab screens.

// ── Layout ──

export const layout = StyleSheet.create({
  /** Full-screen dark root with flex:1 */
  root: { flex: 1, backgroundColor: theme.colors.bg },
  /** Absolute gradient glow overlay — place as first child in root */
  glow: { position: "absolute" as const, top: 0, left: 0, right: 0, height: 300 },
  /** ScrollView content container with standard side padding */
  content: { paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(12), gap: theme.spacing(4) },
  /** Horizontal padding for flat lists */
  contentFlat: { paddingHorizontal: theme.spacing(4) },
});

// ── Cards ──

export const card = StyleSheet.create({
  /** Standard surface card */
  surface: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  /** Elevated card (slightly lighter bg) */
  elevated: {
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  /** State card for loading / empty / error */
  state: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(6),
    gap: theme.spacing(3),
    alignItems: "center" as const,
  },
  /** Accent-bordered depth card — subtle glow at the border */
  depth: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: "rgba(184,255,60,0.18)",
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
});

// ── Typography ──

export const type = StyleSheet.create({
  /** Uppercase accent eyebrow */
  eyebrow: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 2,
    fontFamily: theme.font.mono,
  },
  /** Large hero/screen title */
  hero: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: "800" as const,
    letterSpacing: -0.5,
  },
  /** Hero subtitle */
  sub: {
    color: theme.colors.textDim,
    fontSize: 13,
    lineHeight: 20,
    marginTop: theme.spacing(1.5),
  },
  /** Section header with mono uppercase */
  sectionTitle: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    fontFamily: theme.font.mono,
  },
  /** Section header row */
  sectionHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: theme.spacing(2),
  },
  /** State card descriptive text */
  stateText: {
    color: theme.colors.textDim,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center" as const,
  },
  /** State card hint text */
  stateHint: {
    color: theme.colors.textFaint,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center" as const,
    fontFamily: theme.font.mono,
  },
});

// ── Forms ──

export const form = StyleSheet.create({
  /** Standard text input */
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    color: theme.colors.text,
    fontSize: 14,
    fontFamily: theme.font.mono,
  } as const,
  /** Mono field label */
  label: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1,
    fontFamily: theme.font.mono,
  },
  /** Form error text */
  error: { color: theme.colors.danger, fontSize: 12 },
  /** Primary submit/deploy button */
  submitBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing(3.5),
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: theme.spacing(2),
  },
  /** Submit button text */
  submitText: {
    color: theme.colors.bg,
    fontSize: 14,
    fontWeight: "800" as const,
  },
});

// ── States ──

export const states = StyleSheet.create({
  /** Standard pressed state */
  pressed: { opacity: 0.55 },
  /** Loading spinner row */
  loadRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: theme.spacing(2),
    padding: theme.spacing(3),
  },
  /** Loading row text */
  loadText: { color: theme.colors.textDim, fontSize: 13 },
});

// ── Skeleton ──

export const skeleton = StyleSheet.create({
  /** Skeleton loading placeholder — pulsing block */
  block: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    overflow: "hidden" as const,
  },
  /** Smaller skeleton block for rows */
  row: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    height: 16,
  },
  /** Short skeleton block (for labels) */
  short: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    height: 12,
    width: "40%" as const,
  },
});

// ── Lists ──

export const list = StyleSheet.create({
  /** Standard list gap */
  gap: { gap: theme.spacing(3) },
  /** Horizontal gap row */
  rowGap: { gap: theme.spacing(2) },
});
