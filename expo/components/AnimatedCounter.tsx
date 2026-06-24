import React, { memo, useEffect, useRef, useState } from "react";
import { Animated, type StyleProp, type TextStyle } from "react-native";

type AnimatedCounterProps = {
  /** Numeric value to count up to. Non-numeric `display` falls back to plain text. */
  value: number | null;
  /** Optional display override (e.g. "12ms" or "—") shown when value is null. */
  display?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
  duration?: number;
};

/**
 * Counts up to a target number with an eased animation. When `value` is null,
 * renders the `display` string verbatim (for placeholders like "—").
 */
function AnimatedCounter({ value, display, suffix = "", style, duration = 700 }: AnimatedCounterProps) {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState("0");
  const fromRef = useRef(0);

  useEffect(() => {
    if (value == null) return;
    const from = fromRef.current;
    anim.setValue(0);
    const id = anim.addListener(({ value: t }) => {
      const current = Math.round(from + (value - from) * t);
      setShown(String(current));
    });
    Animated.timing(anim, {
      toValue: 1,
      duration,
      useNativeDriver: false,
    }).start(() => { fromRef.current = value; });
    return () => anim.removeListener(id);
  }, [value, anim, duration]);

  if (value == null) {
    return <Animated.Text style={style}>{display ?? "—"}</Animated.Text>;
  }

  return <Animated.Text style={style}>{shown}{suffix}</Animated.Text>;
}

export default memo(AnimatedCounter);
