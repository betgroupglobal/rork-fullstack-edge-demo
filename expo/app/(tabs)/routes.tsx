import { LinearGradient } from "expo-linear-gradient";
import { Globe, Loader, Route, Trash2 } from "lucide-react-native";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/constants/theme";
import { useDeleteWorkerRoute, useWorkerRoutes } from "@/hooks/useGateway";
import { useApiKey } from "@/hooks/useApiKey";
import type { WorkerRoute } from "@/lib/api";

export default function RoutesScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data, isLoading, isError, error } = useWorkerRoutes(ah);
  const deleteRoute = useDeleteWorkerRoute(ah);

  const routes = data ?? { configured: false, routes: [] };

  const remove = useCallback(
    (route: WorkerRoute) => {
      const zoneId = route.zoneId;
      if (!zoneId) return;
      const run = () => deleteRoute.mutate({ routeId: route.id, zoneId });
      if (Platform.OS === "web") {
        run();
        return;
      }
      Alert.alert(
        "Remove route",
        `Stop routing "${route.pattern}" on ${route.zoneName ?? "this zone"}?\nThis will break traffic to that pattern.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: run },
        ],
      );
    },
    [deleteRoute],
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[theme.colors.accentGlow, "transparent"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0.5 }}
        style={styles.glow}
        pointerEvents="none"
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + theme.spacing(6) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={styles.eyebrow}>EDGE ROUTES</Text>
          <Text style={styles.hero}>Worker routes</Text>
          <Text style={styles.sub}>
            Every hostname pattern that points to this worker. Removing a route
            stops traffic from being intercepted on that pattern.
          </Text>
        </View>

        {isError ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>
              {error?.message ?? "Could not load worker routes."}
            </Text>
          </View>
        ) : isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.stateText}>Loading routes…</Text>
          </View>
        ) : !routes.configured ? (
          <View style={styles.stateCard}>
            <Globe size={28} color={theme.colors.textFaint} />
            <Text style={styles.stateText}>Cloudflare not configured.</Text>
            <Text style={styles.stateHint}>
              {routes.error ??
                "Add CF_API_KEY and CF_API_EMAIL to the worker environment to manage routes."}
            </Text>
          </View>
        ) : routes.routes.length === 0 ? (
          <View style={styles.stateCard}>
            <Route size={28} color={theme.colors.textFaint} />
            <Text style={styles.stateText}>No worker routes yet.</Text>
            <Text style={styles.stateHint}>
              Allocate a domain on a proxy to create a route, or add one manually
              in the Cloudflare dashboard.
            </Text>
          </View>
        ) : (
          <View style={styles.table}>
            <View style={styles.headerRow}>
              <Text style={[styles.headerCell, { flex: 2 }]}>PATTERN</Text>
              <Text style={[styles.headerCell, { flex: 1 }]}>ZONE</Text>
              <Text style={[styles.headerCell, { flex: 1 }]}>WORKER</Text>
              <View style={{ width: 44 }} />
            </View>
            {routes.routes.map((route) => (
              <View key={route.id} style={styles.row}>
                <View style={[styles.cell, { flex: 2 }]}>
                  <Text style={styles.pattern} numberOfLines={1}>
                    {route.pattern}
                  </Text>
                </View>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text style={styles.zone} numberOfLines={1}>
                    {route.zoneName ?? "—"}
                  </Text>
                </View>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text style={styles.script} numberOfLines={1}>
                    {route.script}
                  </Text>
                </View>
                <Pressable
                  onPress={() => remove(route)}
                  disabled={deleteRoute.isPending || !route.zoneId}
                  style={({ pressed }) => [styles.delBtn, pressed && styles.pressed]}
                >
                  {deleteRoute.isPending ? (
                    <Loader size={14} color={theme.colors.danger} />
                  ) : (
                    <Trash2 size={14} color={theme.colors.danger} />
                  )}
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 280 },
  content: {
    paddingHorizontal: theme.spacing(5),
    paddingBottom: theme.spacing(12),
    gap: theme.spacing(5),
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    fontFamily: theme.font.mono,
  },
  hero: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginTop: theme.spacing(1),
  },
  sub: {
    color: theme.colors.textDim,
    fontSize: 14,
    lineHeight: 21,
    marginTop: theme.spacing(2),
  },
  stateCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(6),
    gap: theme.spacing(3),
    alignItems: "center",
  },
  stateText: {
    color: theme.colors.textDim,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  stateHint: {
    color: theme.colors.textFaint,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    fontFamily: theme.font.mono,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontFamily: theme.font.mono,
    textAlign: "center",
  },
  table: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerCell: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  cell: { paddingRight: theme.spacing(2) },
  pattern: {
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.font.mono,
    fontWeight: "700",
  },
  zone: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontFamily: theme.font.mono,
  },
  script: {
    color: theme.colors.warn,
    fontSize: 12,
    fontFamily: theme.font.mono,
  },
  delBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pressed: { opacity: 0.55 },
});
