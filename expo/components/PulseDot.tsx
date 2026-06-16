import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

type PulseDotProps = {
  color: string;
  active: boolean;
  size?: number;
};

/** A status dot that emits an expanding pulse ring while active. */
export default function PulseDot({ color, active, size = 12 }: PulseDotProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1600,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {active ? (
        <Animated.View
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              transform: [{ scale }],
              opacity,
            },
          ]}
        />
      ) : null}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
  },
});
