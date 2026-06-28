import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@/constants/theme";
import CopyBtn from "./CopyBtn";

type CredRowProps = {
  label: string;
  value: string;
  type: "sensitive" | "credential" | "normal";
};

/** Table row for intercepted credential/field values with type-based styling. */
export default function CredRow({ label, value, type }: CredRowProps) {
  return (
    <View
      style={[
        styles.row,
        type === "sensitive" && styles.rowSens,
        type === "credential" && styles.rowCred,
      ]}
    >
      <View style={styles.keyCell}>
        {type !== "normal" && (
          <View style={[styles.badge, type === "sensitive" ? styles.badgeSens : styles.badgeCred]}>
            <Text style={styles.badgeText}>
              {type === "sensitive" ? "PASS" : "ID"}
            </Text>
          </View>
        )}
        <Text style={styles.key} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.valCell}>
        <Text
          style={[
            styles.val,
            type === "sensitive" && styles.valSens,
            type === "credential" && styles.valCred,
          ]}
          selectable
          numberOfLines={0}
        >
          {value || "\u2014"}
        </Text>
        <CopyBtn value={value} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
    gap: theme.spacing(2),
  },
  rowSens: { backgroundColor: "rgba(239,68,68,0.07)" },
  rowCred: { backgroundColor: "rgba(255,178,62,0.05)" },
  keyCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    flexWrap: "wrap",
  },
  badge: { borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  badgeSens: { backgroundColor: "rgba(239,68,68,0.3)" },
  badgeCred: { backgroundColor: "rgba(255,178,62,0.3)" },
  badgeText: {
    fontSize: 8,
    fontWeight: "800",
    fontFamily: theme.font.mono,
    color: theme.colors.text,
  },
  key: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono },
  valCell: {
    flex: 2,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing(1.5),
  },
  val: {
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.font.mono,
    flex: 1,
    lineHeight: 19,
  },
  valSens: { color: "#f87171", fontWeight: "700" },
  valCred: { color: theme.colors.warn, fontWeight: "700" },
});
