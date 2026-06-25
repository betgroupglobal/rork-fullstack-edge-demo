import { RefreshCw, WifiOff } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "@/constants/theme";

type OfflineCardProps = {
  message?: string;
  onRetry?: () => void;
};

export default function OfflineCard({
  message = "Gateway is unreachable. Check your connection and gateway URL, then retry.",
  onRetry,
}: OfflineCardProps) {
  return (
    <View style={styles.card}>
      <WifiOff size={28} color={theme.colors.danger} />
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
          <RefreshCw size={14} color={theme.colors.bg} />
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(6),
    gap: theme.spacing(3),
    alignItems: "center",
  },
  message: {
    color: theme.colors.textDim,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2.5),
    marginTop: theme.spacing(2),
  },
  retryText: {
    color: theme.colors.bg,
    fontSize: 13,
    fontWeight: "800",
  },
  pressed: { opacity: 0.55 },
});
