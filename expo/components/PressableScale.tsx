import * as Haptics from "expo-haptics";
import React, { useCallback, useRef } from "react";
import {
  Animated,
  Platform,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type HapticStyle = "light" | "medium" | "heavy" | "selection" | "none";

type PressableScaleProps = Omit<PressableProps, "style"> & {
  children: React.ReactNode;
  /** Scale applied while pressed. Defaults to 0.96. */
  scaleTo?: number;
  /** Haptic feedback fired on press-in. Defaults to "light". */
  haptic?: HapticStyle;
  style?: StyleProp<ViewStyle>;
};

/**
 * A Pressable that springs slightly on touch and emits haptic feedback,
 * giving every tap a tactile, native feel.
 */
export default function PressableScale({
  children,
  scaleTo = 0.96,
  haptic = "light",
  style,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const fireHaptic = useCallback(() => {
    if (haptic === "none" || Platform.OS === "web") return;
    if (haptic === "selection") {
      Haptics.selectionAsync();
      return;
    }
    const map = {
      light: Haptics.ImpactFeedbackStyle.Light,
      medium: Haptics.ImpactFeedbackStyle.Medium,
      heavy: Haptics.ImpactFeedbackStyle.Heavy,
    } as const;
    Haptics.impactAsync(map[haptic]);
  }, [haptic]);

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      fireHaptic();
      Animated.spring(scale, {
        toValue: scaleTo,
        useNativeDriver: true,
        speed: 50,
        bounciness: 0,
      }).start();
      onPressIn?.(e);
    },
    [fireHaptic, onPressIn, scale, scaleTo],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 40,
        bounciness: 8,
      }).start();
      onPressOut?.(e);
    },
    [onPressOut, scale],
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }, disabled && { opacity: 0.5 }]}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        style={style}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
