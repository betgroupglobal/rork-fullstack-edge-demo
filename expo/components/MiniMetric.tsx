import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@/constants/theme";

type MiniMetricProps = { label: string; value: number };

/** Compact metric pill used in the recon intel card. */
export default function MiniMetric({ label, value }: MiniMetricProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(2.5),
    alignItems: "center",
  },
  value: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: theme.font.mono,
  },
  label: {
    color: theme.colors.textFaint,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
    fontFamily: theme.font.mono,
    marginTop: 2,
  },
});
