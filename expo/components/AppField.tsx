import React from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "@/constants/theme";

type AppFieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
};

/** Simple labelled text input for app settings. */
export default function AppField({
  label,
  value,
  onChange,
  placeholder,
}: AppFieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  label: { color: theme.colors.textDim, fontSize: 11, fontWeight: "600" },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: Platform.select({ ios: 10, default: 8 }),
    paddingHorizontal: theme.spacing(3),
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.font.mono,
  },
});
