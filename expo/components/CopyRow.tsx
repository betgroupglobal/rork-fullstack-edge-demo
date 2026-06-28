import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/constants/theme";

type CopyRowProps = { label: string; value: string };

/** Read-only row that copies its value on tap. */
export default function CopyRow({ label, value }: CopyRowProps) {
  const [copied, setCopied] = useState(false);

  return (
    <Pressable
      onPress={async () => {
        await Clipboard.setStringAsync(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Copy size={13} color={theme.colors.textDim} />
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
      {copied ? (
        <Check size={13} color={theme.colors.ok} />
      ) : (
        <Copy size={13} color={theme.colors.textFaint} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  body: { flex: 1, gap: 1 },
  label: { color: theme.colors.textDim, fontSize: 11, fontWeight: "600" },
  value: { color: theme.colors.text, fontSize: 12, fontFamily: theme.font.mono },
  pressed: { opacity: 0.55 },
});
