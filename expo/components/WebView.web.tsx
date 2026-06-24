import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function WebView({ style }: { style?: any }) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.text}>
        Phishlet scanning requires the native mobile app. The web preview does not support an embedded browser.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: "#111",
  },
  text: {
    color: "#fff",
    textAlign: "center",
  },
});
