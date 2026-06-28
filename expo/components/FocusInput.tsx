import React, { useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { theme } from "@/constants/theme";

type FocusInputProps = TextInputProps & {
  /** Whether to show the accent glow ring on focus. Default true. */
  glow?: boolean;
};

/**
 * TextInput with a subtle electric-lime glow ring that scales in on focus.
 * Drop-in replacement for standard TextInput.
 */
export default function FocusInput({ glow = true, style, onFocus, onBlur, ...rest }: FocusInputProps) {
  const [focused, setFocused] = useState(false);
  const ringScale = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  const handleFocus = (e: Parameters<NonNullable<TextInputProps["onFocus"]>>[0]) => {
    setFocused(true);
    Animated.parallel([
      Animated.spring(ringScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }),
      Animated.timing(ringOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    onFocus?.(e);
  };

  const handleBlur = (e: Parameters<NonNullable<TextInputProps["onBlur"]>>[0]) => {
    setFocused(false);
    Animated.parallel([
      Animated.timing(ringScale, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(ringOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
    onBlur?.(e);
  };

  return (
    <View>
      {glow ? (
        <Animated.View
          style={[
            styles.ring,
            {
              transform: [{ scale: ringScale }],
              opacity: ringOpacity,
            },
          ]}
        />
      ) : null}
      <TextInput
        style={[style, focused && glow && styles.focused]}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholderTextColor={rest.placeholderTextColor ?? theme.colors.textFaint}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: theme.radius.sm + 2,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    pointerEvents: "none",
  },
  focused: {
    borderColor: theme.colors.accent,
  },
});
