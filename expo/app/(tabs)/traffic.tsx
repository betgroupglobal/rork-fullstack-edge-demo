import { LinearGradient } from "expo-linear-gradient";
import {
  AlertTriangle,
  Database,
  Radio,
  RefreshCw,
  Timer,
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
import { useTraffic } from "@/hooks/useGateway";
import type { TrafficEntry } from "@/lib/api";

function methodColor(method: string): string {
  switch (method) {
    case "GET":
      return theme.colors.cyan;
    case "POST":
      return theme.colors.ok;
    case "PUT":
      return theme.colors.warn;
    case "DELETE":
      return theme.colors.danger;
    default:
      return theme.colors.textDim;
  }
}

function statusColor(status: number): string {
  if (status >= 500) return theme.colors.danger;
  if (status >= 400) return theme.colors.warn;
  if (status >= 300) return theme.colors.cyan;
  return theme.colors.ok;
}

function ago(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 1) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function TrafficRow({ entry }: { entry: TrafficEntry }) {
  return (
    <View style={styles.row}>
      <View style={[styles.method, { borderColor: methodColor(entry.method) }]}>
        <Text style={[styles.methodText, { color: methodColor(entry.method) }]}>
          {entry.method}
        </Text>
      </View>
      <View style={styles.rowMid}>
        <Text style={styles.path} numberOfLines={1}>
          {entry.path}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={[styles.status, { color: statusColor(entry.status) }]}>
            {entry.status}
          </Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>{entry.latencyMs}ms</Text>
          {entry.cache ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Text
                style={[
                  styles.cacheTag,
                  {
                    color:
                      entry.cache === "HIT"
                        ? theme.colors.accent
                        : theme.colors.textFaint,
                  },
                ]}
              >
                {entry.cache}
              </Text>
            </>
          ) : null}
          {entry.country ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaText}>{entry.country}</Text>
            </>
          ) : null}
        </View>
      </View>
      <Text style={styles.age}>{ago(entry.ts)}</Text>
    </View>
  );
}

export default function TrafficScreen() {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, error, refetch, isFetching } = useTraffic();

  const live = !isError && !!data;

  const cards = useMemo(
    () => [
      {
        icon: Database,
        label: "Captured",
        value: data ? String(data.stats.total) : "—",
        accent: theme.colors.accent,
      },
      {
        icon: Timer,
        label: "Avg latency",
        value: data ? `${data.stats.avgLatency}ms` : "—",
        accent: theme.colors.cyan,
      },
      {
        icon: Zap,
        label: "Cache hits",
        value: data ? String(data.stats.cacheHits) : "—",
        accent: theme.colors.ok,
      },
      {
        icon: AlertTriangle,
        label: "Errors",
        value: data ? String(data.stats.errorCount) : "—",
        accent: theme.colors.danger,
      },
    ],
    [data],
  );

  const entries = data?.entries ?? [];

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
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>TRAFFIC ANALYSER</Text>
            <Text style={styles.hero}>Intercepted at the edge</Text>
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

        <View style={styles.liveRow}>
          <PulseDot
            color={live ? theme.colors.ok : theme.colors.danger}
            active={live}
            size={10}
          />
          <Text style={styles.liveText}>
            {live
              ? "Live · every request through the gateway is logged · 4s refresh"
              : "Analyser offline"}
          </Text>
        </View>

        <View style={styles.grid}>
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <View key={card.label} style={styles.statCard}>
                <Icon size={18} color={card.accent} />
                <Text style={styles.statValue}>{card.value}</Text>
                <Text style={styles.statLabel}>{card.label}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>REQUEST FEED</Text>

        {isError ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>
              {error?.message ?? "Could not load the traffic feed."}
            </Text>
          </View>
        ) : isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.stateText}>Listening for traffic…</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.stateCard}>
            <Radio size={22} color={theme.colors.textFaint} />
            <Text style={styles.stateText}>
              No traffic yet. Open the Status or Items tab to send requests
              through the gateway, then come back.
            </Text>
          </View>
        ) : (
          <View style={styles.feed}>
            {entries.map((entry) => (
              <TrafficRow key={entry.id} entry={entry} />
            ))}
          </View>
        )}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  liveText: {
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
  sectionTitle: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontFamily: theme.font.mono,
    marginTop: theme.spacing(1),
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
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontFamily: theme.font.mono,
    textAlign: "center",
  },
  feed: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    paddingHorizontal: theme.spacing(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  method: {
    minWidth: 58,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    alignItems: "center",
  },
  methodText: {
    fontSize: 11,
    fontWeight: "800",
    fontFamily: theme.font.mono,
    letterSpacing: 0.5,
  },
  rowMid: {
    flex: 1,
    gap: 3,
  },
  path: {
    color: theme.colors.text,
    fontSize: 14,
    fontFamily: theme.font.mono,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  status: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: theme.font.mono,
  },
  metaText: {
    color: theme.colors.textFaint,
    fontSize: 12,
    fontFamily: theme.font.mono,
  },
  metaDot: {
    color: theme.colors.textFaint,
    fontSize: 12,
  },
  cacheTag: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: theme.font.mono,
  },
  age: {
    color: theme.colors.textFaint,
    fontSize: 12,
    fontFamily: theme.font.mono,
  },
});
