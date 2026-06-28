import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { theme } from "@/constants/theme";

type CopyBtnProps = { value: string; size?: number };

/** One-tap copy button with checkmark feedback. */
export default function CopyBtn({ value, size = 11 }: CopyBtnProps) {
  const [done, setDone] = useState(false);
  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(value);
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  }, [value]);

  return (
    <Pressable
      onPress={copy}
      hitSlop={8}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      {done ? (
        <Check size={size} color={theme.colors.ok} />
      ) : (
        <Copy size={size} color={theme.colors.textFaint} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingTop: 2 },
  pressed: { opacity: 0.55 },
});
