import { LinearGradient } from "expo-linear-gradient";
import {
  Activity,
  Clock,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react-native";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PulseDot from "@/components/PulseDot";
import { theme } from "@/constants/theme";
import { useHealth } from "@/hooks/useGateway";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function StatusScreen() {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, error, refetch, isFetching } = useHealth();

  const healthy = !isError && !!data;
  const statusColor = isError
    ? theme.colors.danger
    : healthy
      ? theme.colors.ok
      : theme.colors.warn;
  const statusLabel = isError
    ? "UNREACHABLE"
    : healthy
      ? "OPERATIONAL"
      : "CONNECTING";

  const stats = useMemo(
    () => [
      {
        icon: Zap,
        label: "Round-trip",
        value: data ? `${data.meta.latencyMs}ms` : "—",
        accent: theme.colors.accent,
      },
      {
        icon: Gauge,
        label: "Edge time",
        value: data?.meta.edgeLatency ?? "—",
        accent: theme.colors.cyan,
      },
      {
        icon: Clock,
        label: "Uptime",
        value: data ? formatUptime(data.uptime) : "—",
        accent: theme.colors.ok,
      },
      {
        icon: Activity,
        label: "Rate budget",
        value:
          data?.meta.rateRemaining != null && data?.meta.rateLimit != null
            ? `${data.meta.rateRemaining}/${data.meta.rateLimit}`
            : "—",
        accent: theme.colors.warn,
      },
    ],
    [data],
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
        <Text style={styles.eyebrow}>EDGE GATEWAY DASHBOARD</Text>
        <Text style={styles.hero}>
          Your API, served from the{"\n"}
          <Text style={styles.heroAccent}>edge.</Text>
        </Text>
        <Text style={styles.subhero}>
          A live look at the Cloudflare Worker fronting your Items store —
          health, latency, and the gateway pipeline in real time.
        </Text>

        <View style={styles.statusCard}>
          <View style={styles.statusTop}>
            <View style={styles.statusLeft}>
              <PulseDot color={statusColor} active={healthy} size={12} />
              <View>
                <Text style={[styles.statusLabel, { color: statusColor }]}>
                  {statusLabel}
                </Text>
                <Text style={styles.statusSub}>gateway · /health</Text>
              </View>
            </View>
            <Pressable
              onPress={() => refetch()}
              style={({ pressed }) => [
                styles.refreshBtn,
                pressed && styles.refreshBtnPressed,
              ]}
              hitSlop={10}
            >
              {isFetching ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : (
                <RefreshCw size={16} color={theme.colors.accent} />
              )}
            </Pressable>
          </View>

          {isError ? (
            <Text style={styles.errorText}>
              {error?.message ?? "Could not reach the gateway."}
            </Text>
          ) : (
            <View style={styles.healthyRow}>
              <ShieldCheck size={15} color={theme.colors.ok} />
              <Text style={styles.healthyText}>
                {isLoading
                  ? "Pinging the edge…"
                  : `Healthy · ${data?.itemCount ?? 0} items stored · auto-refresh 5s`}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.grid}>
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <View key={stat.label} style={styles.statCard}>
                <Icon size={18} color={stat.accent} />
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.cacheCard}>
          <Text style={styles.cacheTitle}>EDGE CACHE</Text>
          <Text style={styles.cacheBody}>
            Reads are cached at the edge for 10s. The latest probe was a{" "}
            <Text style={styles.cacheTag}>{data?.meta.cache ?? "—"}</Text>.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  glow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 320,
  },
  content: {
    paddingHorizontal: theme.spacing(5),
    paddingBottom: theme.spacing(10),
    gap: theme.spacing(4),
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
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 44,
    letterSpacing: -1,
  },
  heroAccent: {
    color: theme.colors.accent,
  },
  subhero: {
    color: theme.colors.textDim,
    fontSize: 15,
    lineHeight: 22,
  },
  statusCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(5),
    gap: theme.spacing(4),
    marginTop: theme.spacing(2),
  },
  statusTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
  },
  statusLabel: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
  },
  statusSub: {
    color: theme.colors.textFaint,
    fontSize: 12,
    fontFamily: theme.font.mono,
    marginTop: 2,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshBtnPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.94 }],
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontFamily: theme.font.mono,
  },
  healthyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  healthyText: {
    color: theme.colors.textDim,
    fontSize: 13,
    flexShrink: 1,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(3),
  },
  statCard: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(2),
  },
  statValue: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: theme.font.mono,
  },
  statLabel: {
    color: theme.colors.textFaint,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  cacheCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(2),
  },
  cacheTitle: {
    color: theme.colors.cyan,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontFamily: theme.font.mono,
  },
  cacheBody: {
    color: theme.colors.textDim,
    fontSize: 14,
    lineHeight: 21,
  },
  cacheTag: {
    color: theme.colors.accent,
    fontFamily: theme.font.mono,
    fontWeight: "700",
  },
});
