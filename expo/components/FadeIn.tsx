import React, { useEffect, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";

type FadeInProps = {
  children: React.ReactNode;
  /** Delay before the animation starts, in ms. Use to stagger lists. */
  delay?: number;
  /** Vertical offset (px) the view rises from. Defaults to 12. */
  offset?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Fades and slides its children upward on mount. Pair with an incrementing
 * `delay` across a list to create a staggered entrance.
 */
export default function FadeIn({ children, delay = 0, offset = 12, duration = 420, style }: FadeInProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, delay, duration]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] });

  return (
    <Animated.View style={[{ opacity: progress, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}
