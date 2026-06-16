import { Tabs } from "expo-router";
import { Activity, Bug, Cog, Database, Globe, Layers, Radio } from "lucide-react-native";
import React from "react";
import { Platform } from "react-native";

import { theme } from "@/constants/theme";

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
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Status",
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="items"
        options={{
          title: "Items",
          tabBarIcon: ({ color, size }) => <Database color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="proxies"
        options={{
          title: "Proxies",
          tabBarIcon: ({ color, size }) => <Globe color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="traffic"
        options={{
          title: "Traffic",
          tabBarIcon: ({ color, size }) => <Radio color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="intercepts"
        options={{
          title: "Intercepts",
          tabBarIcon: ({ color, size }) => <Bug color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Cog color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          title: "About",
          tabBarIcon: ({ color, size }) => <Layers color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
