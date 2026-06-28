import { Tabs } from "expo-router";
import { Bug, Cog, Globe, LayoutDashboard, Radar } from "lucide-react-native";
import React, { useEffect, useRef } from "react";
import { Animated, Platform } from "react-native";

import { theme } from "@/constants/theme";

/** Animated icon wrapper that scales slightly when the tab is focused. */
function TabIcon({
  focused,
  Icon,
  color,
  size,
}: {
  focused: boolean;
  Icon: React.ElementType;
  color: string;
  size: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1.18 : 1,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [focused, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon color={color} size={size} />
    </Animated.View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textFaint,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.bgElevated,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          height: Platform.select({ ios: 88, default: 64 }),
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused} Icon={LayoutDashboard} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="proxies"
        options={{
          title: "Proxies",
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused} Icon={Globe} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="recon"
        options={{
          title: "Recon",
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused} Icon={Radar} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="intercepts"
        options={{
          title: "Intercepts",
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused} Icon={Bug} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused} Icon={Cog} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
