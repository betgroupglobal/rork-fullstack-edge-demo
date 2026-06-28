import { Eye, EyeOff, RotateCcw } from "lucide-react-native";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { theme } from "@/constants/theme";

const BOOLEAN_FIELDS = new Set(["INTERCEPT_LAB_MODE"]);
const SECRET_FIELDS = new Set(["API_KEY", "TOOLKIT_SECRET"]);

type ConfigFieldProps = {
  fieldKey: string;
  value: string;
  defaultValue: string;
  label: string;
  hint?: string;
  onChange: (key: string, value: string) => void;
};

/** Single runtime config field — supports boolean switches, secret toggles, and value reset. */
export default function ConfigField({
  fieldKey,
  value,
  defaultValue,
  label,
  hint,
  onChange,
}: ConfigFieldProps) {
  const [show, setShow] = useState(false);
  const isBool = BOOLEAN_FIELDS.has(fieldKey);
  const isSecret = SECRET_FIELDS.has(fieldKey);
  const current = value;
  const isModified = current !== (defaultValue ?? "");

  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        <View style={styles.labelWrap}>
          <Text style={styles.key}>{label}</Text>
          <Text style={styles.var}>{fieldKey}</Text>
        </View>
        {isBool ? (
          <Switch
            value={current === "true"}
            onValueChange={() =>
              onChange(fieldKey, current === "true" ? "false" : "true")
            }
            trackColor={{
              false: theme.colors.surfaceAlt,
              true: theme.colors.accentDim,
            }}
            thumbColor={
              current === "true"
                ? theme.colors.accent
                : theme.colors.textFaint
            }
          />
        ) : (
          <View style={styles.valueRow}>
            <TextInput
              style={[styles.input, isSecret && { width: 180 }]}
              value={current}
              onChangeText={(v) => onChange(fieldKey, v)}
              placeholder={defaultValue ?? ""}
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={isSecret && !show}
              textContentType={isSecret ? "password" : "none"}
            />
            {isSecret ? (
              <Pressable onPress={() => setShow((p) => !p)} hitSlop={8}>
                {show ? (
                  <EyeOff size={14} color={theme.colors.textFaint} />
                ) : (
                  <Eye size={14} color={theme.colors.textFaint} />
                )}
              </Pressable>
            ) : isModified ? (
              <Pressable
                onPress={() => onChange(fieldKey, defaultValue ?? "")}
                hitSlop={8}
              >
                <RotateCcw size={14} color={theme.colors.textFaint} />
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
  },
  labelWrap: {
    flex: 1,
    gap: 2,
    marginRight: theme.spacing(3),
  },
  key: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  var: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontFamily: theme.font.mono,
  },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  input: {
    width: 140,
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: Platform.select({ ios: 7, default: 5 }),
    paddingHorizontal: theme.spacing(2),
    color: theme.colors.text,
    fontSize: 12,
    fontFamily: theme.font.mono,
    textAlign: "right",
  },
  hint: {
    color: theme.colors.textFaint,
    fontSize: 10,
    lineHeight: 15,
    fontFamily: theme.font.mono,
    marginTop: theme.spacing(1.5),
  },
});
