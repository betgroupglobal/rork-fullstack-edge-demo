import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  Gauge,
  Package,
  Radio,
  RefreshCw,
  ShieldCheck,
  Timer,
  Zap,
} from "lucide-react-native";
import React, { memo, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AnimatedCounter from "@/components/AnimatedCounter";
import FadeIn from "@/components/FadeIn";
import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import PulseDot from "@/components/PulseDot";
import { SkeletonCard } from "@/components/SkeletonBlock";
import { layout, card, type as typeStyles, states } from "@/constants/styles";
import { theme } from "@/constants/theme";
import { useHealth, useTraffic } from "@/hooks/useGateway";
import type { TrafficEntry } from "@/lib/api";

// ── Helpers ──

function numericPart(raw: string): { value: number | null; suffix: string } {
  const match = raw.match(/^(\d+)(.*)$/);
  if (!match) return { value: null, suffix: "" };
  return { value: parseInt(match[1], 10), suffix: match[2] };
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function statusColor(status: number): string {
  if (status >= 500) return theme.colors.danger;
  if (status >= 400) return theme.colors.warn;
  if (status >= 300) return theme.colors.cyan;
  return theme.colors.ok;
}

function methodColor(method: string): string {
  switch (method) {
    case "GET": return theme.colors.cyan;
    case "POST": return theme.colors.ok;
    case "PUT": return theme.colors.warn;
    case "DELETE": return theme.colors.danger;
    default: return theme.colors.textDim;
  }
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

// ── Traffic row ──

const TrafficRow = memo(function TrafficRow({ entry }: { entry: TrafficEntry }) {
  return (
    <View style={styles.trafficRow}>
      <View style={[styles.methodBadge, { borderColor: methodColor(entry.method) }]}>
        <Text style={[styles.methodText, { color: methodColor(entry.method) }]}>{entry.method}</Text>
      </View>
      <View style={styles.trafficMid}>
        <Text style={styles.trafficPath} numberOfLines={1}>{entry.path}</Text>
        <View style={styles.trafficMeta}>
          <Text style={[styles.trafficStatus, { color: statusColor(entry.status) }]}>{entry.status}</Text>
          <Text style={styles.trafficSep}>·</Text>
          <Text style={styles.trafficLatency}>{entry.latencyMs}ms</Text>
          {entry.cache && (
            <>
              <Text style={styles.trafficSep}>·</Text>
              <Text style={[styles.trafficCache, { color: entry.cache === "HIT" ? theme.colors.accent : theme.colors.textFaint }]}>{entry.cache}</Text>
            </>
          )}
        </View>
      </View>
      <Text style={styles.trafficAge}>{ago(entry.ts)}</Text>
    </View>
  );
});

// ── Main screen ──

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const health = useHealth();
  const traffic = useTraffic();

  const healthy = !health.isError && !!health.data;
  const statusColor = health.isError ? theme.colors.danger : healthy ? theme.colors.ok : theme.colors.warn;
  const statusLabel = health.isError ? "UNREACHABLE" : healthy ? "OPERATIONAL" : "CONNECTING";

  const gateStats = useMemo(() => [
    { icon: Zap, label: "Latency", value: health.data ? `${health.data.meta.latencyMs}ms` : "—", accent: theme.colors.accent },
    { icon: Gauge, label: "Edge", value: health.data?.meta.edgeLatency ?? "—", accent: theme.colors.cyan },
    { icon: Clock, label: "Uptime", value: health.data ? formatUptime(health.data.uptime) : "—", accent: theme.colors.ok },
    { icon: Activity, label: "Rate", value: health.data?.meta.rateRemaining != null && health.data?.meta.rateLimit != null ? `${health.data.meta.rateRemaining}/${health.data.meta.rateLimit}` : "—", accent: theme.colors.warn },
  ], [health.data]);

  const trafficStats = useMemo(() => [
    { icon: Database, label: "Requests", value: traffic.data ? String(traffic.data.stats.total) : "—", accent: theme.colors.accent },
    { icon: Timer, label: "Avg latency", value: traffic.data ? `${traffic.data.stats.avgLatency}ms` : "—", accent: theme.colors.cyan },
    { icon: Zap, label: "Cache hits", value: traffic.data ? String(traffic.data.stats.cacheHits) : "—", accent: theme.colors.ok },
    { icon: AlertTriangle, label: "Errors", value: traffic.data ? String(traffic.data.stats.errorCount) : "—", accent: theme.colors.danger },
  ], [traffic.data]);

  const trafficEntries = traffic.data?.entries ?? [];

  const onRefresh = useCallback(() => {
    health.refetch();
    traffic.refetch();
  }, [health, traffic]);

  const isRefreshing = health.isFetching || traffic.isFetching;

  return (
    <View style={layout.root}>
      <LinearGradient colors={[theme.colors.accentGlow, "transparent"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 0.5 }} style={layout.glow} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[layout.content, { paddingTop: insets.top + theme.spacing(6) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      >
        {/* Header */}
        <Text style={typeStyles.eyebrow}>EDGE GATEWAY</Text>
        <Text style={styles.hero}>
          Gateway status &amp;{"\n"}
          <Text style={styles.heroAccent}>live traffic</Text>
        </Text>

        {/* Gateway health card — depth variant */}
        <View style={card.depth}>
          <View style={styles.healthTop}>
            <View style={styles.healthLeft}>
              <PulseDot color={statusColor} active={healthy} size={10} />
              <View>
                <Text style={[styles.healthStatus, { color: statusColor }]}>{statusLabel}</Text>
                <Text style={styles.healthSub}>gateway · /health</Text>
              </View>
            </View>
            <PressableScale haptic="medium" onPress={onRefresh} style={styles.refreshBtn} hitSlop={10}>
              {isRefreshing ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <RefreshCw size={15} color={theme.colors.accent} />}
            </PressableScale>
          </View>
          {health.isError ? (
            <OfflineCard message={health.error?.message ?? "Could not reach the gateway."} onRetry={() => health.refetch()} />
          ) : (
            <Pressable onPress={() => router.push("/items")} style={({ pressed }) => [styles.healthyRow, pressed && states.pressed]}>
              <ShieldCheck size={14} color={theme.colors.ok} />
              <Package size={14} color={theme.colors.accent} />
              <Text style={styles.healthyText}>{health.data?.itemCount ?? 0} items stored · manage →</Text>
            </Pressable>
          )}
        </View>

        {/* Gateway stats */}
        <View style={styles.statGrid}>
          {gateStats.map((stat, i) => {
            const Icon = stat.icon;
            const { value, suffix } = numericPart(stat.value);
            return (
              <FadeIn key={stat.label} delay={i * 70} style={styles.statCardWrap}>
                <View style={styles.statCard}>
                  <Icon size={16} color={stat.accent} />
                  <AnimatedCounter value={value} display={stat.value} suffix={suffix} style={styles.statValue} />
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              </FadeIn>
            );
          })}
        </View>

        {/* Traffic stats */}
        <View style={typeStyles.sectionHeaderRow}>
          <Radio size={14} color={theme.colors.accent} />
          <Text style={[typeStyles.sectionTitle, { flex: 1 }]}>TRAFFIC</Text>
          {traffic.isFetching && <ActivityIndicator size="small" color={theme.colors.accent} />}
        </View>

        <View style={styles.statGrid}>
          {trafficStats.map((stat, i) => {
            const Icon = stat.icon;
            const { value, suffix } = numericPart(stat.value);
            return (
              <FadeIn key={stat.label} delay={i * 70} style={styles.statCardWrap}>
                <View style={styles.statCard}>
                  <Icon size={16} color={stat.accent} />
                  <AnimatedCounter value={value} display={stat.value} suffix={suffix} style={styles.statValue} />
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              </FadeIn>
            );
          })}
        </View>

        {/* Live request feed */}
        <View style={typeStyles.sectionHeaderRow}>
          <Radio size={14} color={theme.colors.ok} />
          <Text style={[typeStyles.sectionTitle, { flex: 1 }]}>LIVE FEED</Text>
          <PulseDot color={theme.colors.ok} active size={8} />
        </View>

        {traffic.isError ? (
          <OfflineCard message={traffic.error?.message ?? "Could not load traffic."} onRetry={() => traffic.refetch()} />
        ) : traffic.isLoading ? (
          <View style={styles.trafficFeed}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} height={48} />
            ))}
          </View>
        ) : trafficEntries.length === 0 ? (
          <View style={card.state}>
            <Radio size={22} color={theme.colors.textFaint} />
            <Text style={typeStyles.stateText}>No requests yet. Traffic will appear here in real time.</Text>
          </View>
        ) : (
          <View style={styles.trafficFeed}>
            {trafficEntries.slice(0, 15).map((entry, i) => (
              <FadeIn key={entry.id} delay={Math.min(i, 8) * 45} offset={8}>
                <TrafficRow entry={entry} />
              </FadeIn>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { color: theme.colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -1, lineHeight: 36 },
  heroAccent: { color: theme.colors.accent },
  healthTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  healthLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
  healthStatus: { fontSize: 16, fontWeight: "800", letterSpacing: 1, fontFamily: theme.font.mono },
  healthSub: { color: theme.colors.textFaint, fontSize: 11, fontFamily: theme.font.mono, marginTop: 1 },
  refreshBtn: { width: 36, height: 36, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center" },
  healthyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  healthyText: { color: theme.colors.textDim, fontSize: 12, flexShrink: 1 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
  statCardWrap: { flexGrow: 1, flexBasis: "46%" },
  statCard: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3.5), gap: theme.spacing(1.5) },
  statValue: { color: theme.colors.text, fontSize: 20, fontWeight: "800", fontFamily: theme.font.mono },
  statLabel: { color: theme.colors.textFaint, fontSize: 11, letterSpacing: 0.5 },
  trafficFeed: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden", gap: 0 },
  trafficRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3), paddingVertical: theme.spacing(2.5), paddingHorizontal: theme.spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  methodBadge: { minWidth: 52, paddingVertical: 2, paddingHorizontal: theme.spacing(2), borderRadius: theme.radius.sm, borderWidth: 1, alignItems: "center" },
  methodText: { fontSize: 10, fontWeight: "800", fontFamily: theme.font.mono, letterSpacing: 0.5 },
  trafficMid: { flex: 1, gap: 2 },
  trafficPath: { color: theme.colors.text, fontSize: 13, fontFamily: theme.font.mono },
  trafficMeta: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1) },
  trafficStatus: { fontSize: 11, fontWeight: "700", fontFamily: theme.font.mono },
  trafficLatency: { color: theme.colors.textFaint, fontSize: 11, fontFamily: theme.font.mono },
  trafficSep: { color: theme.colors.textFaint, fontSize: 11 },
  trafficCache: { fontSize: 11, fontWeight: "700", fontFamily: theme.font.mono },
  trafficAge: { color: theme.colors.textFaint, fontSize: 10, fontFamily: theme.font.mono },
});
