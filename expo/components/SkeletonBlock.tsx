import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, type ViewStyle } from "react-native";
import { theme } from "@/constants/theme";

type SkeletonBlockProps = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
};

/** Pulsing skeleton placeholder that matches card dimensions. */
export default function SkeletonBlock({
  width = "100%",
  height = 20,
  borderRadius = theme.radius.md,
  style,
}: SkeletonBlockProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          useNativeDriver: false,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.6],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as number | undefined,
          height,
          borderRadius,
          backgroundColor: theme.colors.surfaceAlt,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <SkeletonBlock
      height={height}
      borderRadius={theme.radius.md}
      style={{ borderWidth: 1, borderColor: theme.colors.border }}
    />
  );
}
