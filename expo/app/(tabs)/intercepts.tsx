import { LinearGradient } from "expo-linear-gradient";
import { Download, Play, RefreshCw, ShieldAlert, Trash2 } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CopyBtn from "@/components/CopyBtn";
import FadeIn from "@/components/FadeIn";
import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import { SkeletonCard } from "@/components/SkeletonBlock";
import EmptyState from "@/components/EmptyState";
import TargetGroup from "@/components/TargetGroup";
import { layout, card, type as typeStyles, form, list } from "@/constants/styles";
import { theme } from "@/constants/theme";
import { useDeleteIntercepts, useHarExport, useIntercepts, useReplayHar } from "@/hooks/useGateway";
import { useApiKey } from "@/hooks/useApiKey";
import type { InterceptCapture, ReplayReport } from "@/lib/api";

export default function InterceptsScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data, isLoading, isFetching, isError, error, dataUpdatedAt, refetch } = useIntercepts(ah);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);
  const deleteAll = useDeleteIntercepts(ah);
  const harExport = useHarExport(ah);
  const replay = useReplayHar(ah);

  const [showReplay, setShowReplay] = useState(false);
  const [harPaste, setHarPaste] = useState("");
  const [replaySlug, setReplaySlug] = useState("");
  const [replayResult, setReplayResult] = useState<ReplayReport | null>(null);

  const captures = data ?? [];
  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : null;

  const grouped = useMemo(() => {
    const map = new Map<string, InterceptCapture[]>();
    for (const c of captures) {
      const key = c.slug || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).sort((a, b) =>
      Math.max(...b[1].map((x) => x.ts)) - Math.max(...a[1].map((x) => x.ts)),
    );
  }, [captures]);

  const wipe = useCallback(() => {
    const run = () => deleteAll.mutate();
    if (Platform.OS === "web") { run(); return; }
    Alert.alert("Clear all captures", "Permanently delete all intercept captures?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear all", style: "destructive", onPress: run },
    ]);
  }, [deleteAll]);

  const exportHar = useCallback(async () => {
    try {
      const result = await harExport.mutateAsync();
      if (Platform.OS === "web") {
        const blob = new Blob([result.harJson], { type: "application/har+json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = result.fileName; a.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: result.harJson, title: result.fileName });
      }
    } catch (e: unknown) {
      Alert.alert("HAR Export", e instanceof Error ? e.message : "Export failed");
    }
  }, [harExport]);

  const runReplay = useCallback(async () => {
    if (!harPaste.trim() || !replaySlug.trim()) {
      Alert.alert("Replay", "Paste a HAR JSON blob and specify a target proxy slug.");
      return;
    }
    try {
      const report = await replay.mutateAsync({ har: harPaste.trim(), proxySlug: replaySlug.trim() });
      setReplayResult(report);
    } catch (e: unknown) {
      Alert.alert("Replay Error", e instanceof Error ? e.message : "Replay failed");
    }
  }, [harPaste, replaySlug, replay]);

  return (
    <View style={layout.root}>
      <LinearGradient colors={["rgba(255,178,62,0.12)", "transparent"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 0.5 }} style={layout.glow} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[layout.content, { paddingTop: insets.top + theme.spacing(6) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.warn}
            colors={[theme.colors.warn]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.eyebrowRow}>
              <Text style={[typeStyles.eyebrow, { color: theme.colors.warn }]}>INTERCEPT LAB</Text>
              {isFetching && !isLoading && <RefreshCw size={10} color={theme.colors.warn} />}
            </View>
            <View style={styles.heroRow}>
              <Text style={[typeStyles.hero, { fontSize: 26 }]}>Captures</Text>
              <View style={[styles.countBadge, captures.length > 0 && styles.countBadgeActive]}>
                <Text style={styles.countBadgeText}>{captures.length}</Text>
              </View>
            </View>
            {lastUpdated && <Text style={styles.liveTag}>LIVE · {lastUpdated}</Text>}
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.quickActions}>
          {captures.length > 0 && (
            <>
              <PressableScale onPress={exportHar} disabled={harExport.isPending} haptic="medium" style={[styles.quickBtn, styles.harBtn]}>
                {harExport.isPending ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Download size={14} color={theme.colors.accent} />}
                <Text style={styles.quickText}>Export HAR</Text>
              </PressableScale>
              <PressableScale onPress={() => { setShowReplay(true); setReplayResult(null); }} haptic="medium" style={[styles.quickBtn, styles.playBtn]}>
                <Play size={14} color={theme.colors.cyan} />
                <Text style={[styles.quickText, { color: theme.colors.cyan }]}>Replay</Text>
              </PressableScale>
              <PressableScale onPress={wipe} disabled={deleteAll.isPending} haptic="heavy" style={[styles.quickBtn, styles.clearBtn]}>
                <Trash2 size={14} color={theme.colors.danger} />
                <Text style={[styles.quickText, { color: theme.colors.danger }]}>Clear</Text>
              </PressableScale>
            </>
          )}
        </View>

        {/* Content */}
        {isError ? (
          <OfflineCard message={error?.message ?? "Could not load intercept captures."} onRetry={() => refetch()} />
        ) : isLoading ? (
          <View style={list.gap}>
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={i} height={100} />
            ))}
          </View>
        ) : captures.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert size={26} color={theme.colors.warn} />}
            title="No captures yet"
            subtitle='Toggle "Intercept" on a proxy target to start capturing credentials, forms, and request data from proxied traffic.'
          />
        ) : (
          <View style={list.gap}>
            {grouped.map(([slug, caps], i) => (
              <FadeIn key={slug} delay={i * 70}>
                <TargetGroup slug={slug} captures={caps} />
              </FadeIn>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Replay modal */}
      <Modal visible={showReplay} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowReplay(false)}>
        <View style={[layout.root, { paddingTop: insets.top + theme.spacing(4) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Har Replay Engine</Text>
            <Pressable onPress={() => setShowReplay(false)} style={({ pressed }) => [styles.modalClose, pressed && { opacity: 0.55 }]}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalHint}>
              Paste a HAR (HTTP Archive) JSON blob and specify which proxy target to replay against. The engine sequentially executes every request, tracks cookies, and extracts tokens from the flow.
            </Text>
            <View style={styles.modalField}>
              <Text style={form.label}>PROXY SLUG</Text>
              <TextInput style={form.input} value={replaySlug} onChangeText={setReplaySlug} placeholder="e.g. my-target" placeholderTextColor={theme.colors.textFaint} autoCapitalize="none" autoCorrect={false} />
            </View>
            <View style={styles.modalField}>
              <Text style={form.label}>HAR JSON</Text>
              <TextInput style={[form.input, styles.modalInputLarge]} value={harPaste} onChangeText={setHarPaste} placeholder='Paste HAR JSON here ({"log":...})' placeholderTextColor={theme.colors.textFaint} multiline textAlignVertical="top" autoCapitalize="none" autoCorrect={false} />
            </View>
            <PressableScale onPress={runReplay} disabled={replay.isPending} haptic="medium" style={[form.submitBtn, { backgroundColor: theme.colors.cyan }, replay.isPending && { opacity: 0.5 }]}>
              {replay.isPending ? <ActivityIndicator color={theme.colors.bg} size="small" /> : <Play size={16} color={theme.colors.bg} />}
              <Text style={form.submitText}>{replay.isPending ? "Replaying…" : "Run Replay"}</Text>
            </PressableScale>
            {replayResult && (
              <View style={styles.replayResult}>
                <View style={styles.replayResultHead}>
                  <Text style={styles.replayResultTitle}>REPLAY REPORT</Text>
                  <View style={styles.replayResultStats}>
                    <Text style={styles.replayStatOk}>{replayResult.succeeded} ok</Text>
                    {replayResult.failed > 0 && <Text style={styles.replayStatFail}>{replayResult.failed} failed</Text>}
                    <Text style={styles.replayStatTotal}>{replayResult.total} total</Text>
                  </View>
                </View>
                {replayResult.extractedTokens.length > 0 && (
                  <View style={styles.replayTokens}>
                    <View style={styles.replayTokensHead}>
                      <ShieldAlert size={11} color={theme.colors.warn} />
                      <Text style={styles.replayTokensTitle}>EXTRACTED TOKENS</Text>
                    </View>
                    {replayResult.extractedTokens.map((t, i) => (
                      <View key={i} style={styles.replayTokenRow}>
                        <Text style={styles.replayTokenText} selectable numberOfLines={2}>{t}</Text>
                        <CopyBtn value={t} size={11} />
                      </View>
                    ))}
                  </View>
                )}
                <View style={styles.replayFlow}>
                  <Text style={styles.replayFlowTitle}>FLOW SUMMARY</Text>
                  <Text style={styles.replayFlowText} selectable>{replayResult.flowSummary}</Text>
                </View>
                <View style={styles.replayEntries}>
                  <Text style={styles.replayEntriesTitle}>REQUEST LOG</Text>
                  {replayResult.entries.map((entry) => (
                    <View key={entry.index} style={styles.replayEntryRow}>
                      <View style={styles.replayEntryMeta}>
                        <Text style={[styles.replayEntryMethod, entry.status >= 400 || entry.status === 0 ? styles.replayEntryErr : styles.replayEntryOk]}>{entry.method}</Text>
                        <Text style={styles.replayEntryStatus}>{entry.status || "ERR"}</Text>
                        <Text style={styles.replayEntryLatency}>{entry.latencyMs}ms</Text>
                      </View>
                      <Text style={styles.replayEntryUrl} numberOfLines={1}>{entry.url}</Text>
                      {entry.error && <Text style={styles.replayEntryError}>{entry.error}</Text>}
                      {entry.redirectUrl && <Text style={styles.replayEntryRedirect}>→ {entry.redirectUrl}</Text>}
                      {entry.cookies.length > 0 && <Text style={styles.replayEntryCookies}>{entry.cookies.length} cookie(s)</Text>}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerLeft: { flex: 1, gap: theme.spacing(1) },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  heroRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  countBadge: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, paddingHorizontal: theme.spacing(2), paddingVertical: 2, borderWidth: 1, borderColor: theme.colors.border },
  countBadgeActive: { backgroundColor: "rgba(255,178,62,0.15)", borderColor: "rgba(255,178,62,0.4)" },
  countBadgeText: { color: theme.colors.warn, fontSize: 12, fontWeight: "800", fontFamily: theme.font.mono },
  liveTag: { color: theme.colors.warn, fontSize: 10, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono, opacity: 0.7 },
  quickActions: { flexDirection: "row", gap: theme.spacing(2), flexWrap: "wrap" },
  quickBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(1.5), borderRadius: theme.radius.sm, borderWidth: 1, paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2.5) },
  harBtn: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface },
  playBtn: { borderColor: theme.colors.cyan, backgroundColor: theme.colors.surface },
  clearBtn: { borderColor: theme.colors.danger, backgroundColor: theme.colors.surface },
  quickText: { color: theme.colors.accent, fontSize: 11, fontWeight: "700" },

  // Modal
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" },
  modalClose: { paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(1.5), backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm },
  modalCloseText: { color: theme.colors.textDim, fontSize: 13, fontWeight: "600" },
  modalContent: { padding: theme.spacing(4), paddingBottom: theme.spacing(16), gap: theme.spacing(4) },
  modalHint: { color: theme.colors.textDim, fontSize: 13, lineHeight: 20, fontFamily: theme.font.mono },
  modalField: { gap: theme.spacing(1.5) },
  modalInputLarge: { minHeight: 140, paddingTop: theme.spacing(2.5) },

  // Replay result
  replayResult: { gap: theme.spacing(4) },
  replayResultHead: { gap: theme.spacing(1.5) },
  replayResultTitle: { color: theme.colors.cyan, fontSize: 12, fontWeight: "800", letterSpacing: 1.2, fontFamily: theme.font.mono },
  replayResultStats: { flexDirection: "row", gap: theme.spacing(3), flexWrap: "wrap" },
  replayStatOk: { color: theme.colors.ok, fontSize: 12, fontWeight: "700", fontFamily: theme.font.mono },
  replayStatFail: { color: theme.colors.danger, fontSize: 12, fontWeight: "700", fontFamily: theme.font.mono },
  replayStatTotal: { color: theme.colors.textDim, fontSize: 12, fontFamily: theme.font.mono },
  replayTokens: { backgroundColor: "rgba(255,178,62,0.08)", borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,178,62,0.2)", padding: theme.spacing(3), gap: theme.spacing(2) },
  replayTokensHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  replayTokensTitle: { color: theme.colors.warn, fontSize: 10, fontWeight: "800", letterSpacing: 1, fontFamily: theme.font.mono },
  replayTokenRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing(2), paddingVertical: theme.spacing(1), borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  replayTokenText: { color: theme.colors.warn, fontSize: 11, fontFamily: theme.font.mono, flex: 1, lineHeight: 17 },
  replayFlow: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), gap: theme.spacing(2) },
  replayFlowTitle: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "800", letterSpacing: 1, fontFamily: theme.font.mono },
  replayFlowText: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, lineHeight: 18 },
  replayEntries: { gap: theme.spacing(1) },
  replayEntriesTitle: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "800", letterSpacing: 1, fontFamily: theme.font.mono, marginBottom: theme.spacing(1) },
  replayEntryRow: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), gap: theme.spacing(1) },
  replayEntryMeta: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  replayEntryMethod: { fontSize: 10, fontWeight: "800", fontFamily: theme.font.mono },
  replayEntryOk: { color: theme.colors.ok },
  replayEntryErr: { color: theme.colors.danger },
  replayEntryStatus: { color: theme.colors.textDim, fontSize: 10, fontFamily: theme.font.mono },
  replayEntryLatency: { color: theme.colors.textFaint, fontSize: 10, fontFamily: theme.font.mono },
  replayEntryUrl: { color: theme.colors.textDim, fontSize: 10, fontFamily: theme.font.mono },
  replayEntryError: { color: theme.colors.danger, fontSize: 10, fontFamily: theme.font.mono },
  replayEntryRedirect: { color: theme.colors.cyan, fontSize: 10, fontFamily: theme.font.mono },
  replayEntryCookies: { color: theme.colors.warn, fontSize: 10, fontFamily: theme.font.mono },
});
