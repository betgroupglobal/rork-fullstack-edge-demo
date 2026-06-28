import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@/constants/theme";

type EmptyStateProps = {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
};

/** Animated empty state placeholder with larger contextual icon and accent styling. */
export default function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  return (
    <View style={styles.card}>
      <LinearGradient
        colors={[theme.colors.accentGlow, "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.6 }}
        style={styles.innerGlow}
      />
      <View style={styles.iconWrap}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: "rgba(184,255,60,0.12)",
    padding: theme.spacing(6),
    gap: theme.spacing(3),
    alignItems: "center",
    overflow: "hidden",
  },
  innerGlow: {
    position: "absolute",
    top: 0,
    left: 20,
    right: 20,
    height: 60,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(184,255,60,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.textDim,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    fontFamily: theme.font.mono,
  },
});
