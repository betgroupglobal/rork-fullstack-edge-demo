import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { Check, ChevronDown, ChevronRight, Copy, Download, Play, RefreshCw, ShieldAlert, Trash2 } from "lucide-react-native";
import React, { memo, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FadeIn from "@/components/FadeIn";
import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import { theme } from "@/constants/theme";
import { useDeleteIntercepts, useHarExport, useIntercepts, useReplayHar } from "@/hooks/useGateway";
import { useApiKey } from "@/hooks/useApiKey";
import { CREDENTIAL_FIELDS, SENSITIVE_FIELDS, type InterceptCapture, type ReplayReport } from "@/lib/api";

// ── Body parsing ──

function parseBody(raw: string): Array<{ key: string; value: string }> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const rec = obj as Record<string, unknown>;
      const inner = rec.form ?? rec.data ?? rec;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return Object.entries(inner as Record<string, unknown>).map(([key, value]) => ({
          key, value: typeof value === "string" ? value : JSON.stringify(value),
        }));
      }
    }
  } catch { /* not JSON */ }
  if (raw.includes("=")) {
    try {
      const params = new URLSearchParams(raw);
      const result: Array<{ key: string; value: string }> = [];
      params.forEach((v, k) => result.push({ key: k, value: v }));
      if (result.length > 0) return result;
    } catch { /* not URL-encoded */ }
  }
  return null;
}

function extractUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj.url === "string" ? obj.url : null;
  } catch { return null; }
}

function fieldType(key: string): "credential" | "sensitive" | "normal" {
  const lower = key.toLowerCase();
  if (CREDENTIAL_FIELDS.has(lower)) return "credential";
  if (SENSITIVE_FIELDS.has(lower)) return "sensitive";
  for (const f of CREDENTIAL_FIELDS) {
    if (lower.includes(f)) return SENSITIVE_FIELDS.has(f) ? "sensitive" : "credential";
  }
  return "normal";
}

// ── Mini components ──

const CopyBtn = memo(function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(value);
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  }, [value]);
  return (
    <Pressable onPress={copy} hitSlop={8} style={({ pressed }) => [styles.copyIcon, pressed && styles.pressed]}>
      {done ? <Check size={11} color={theme.colors.ok} /> : <Copy size={11} color={theme.colors.textFaint} />}
    </Pressable>
  );
});

const CredRow = memo(function CredRow({ label, value, type }: { label: string; value: string; type: "sensitive" | "credential" | "normal" }) {
  return (
    <View style={[styles.tblRow, type === "sensitive" && styles.tblRowSens, type === "credential" && styles.tblRowCred]}>
      <View style={styles.tblKeyCell}>
        {type !== "normal" && (
          <View style={[styles.tblBadge, type === "sensitive" ? styles.tblBadgeSens : styles.tblBadgeCred]}>
            <Text style={styles.tblBadgeText}>{type === "sensitive" ? "PASS" : "ID"}</Text>
          </View>
        )}
        <Text style={styles.tblKey} numberOfLines={1}>{label}</Text>
      </View>
      <View style={styles.tblValCell}>
        <Text style={[styles.tblVal, type === "sensitive" && styles.tblValSens, type === "credential" && styles.tblValCred]} selectable numberOfLines={0}>
          {value || "—"}
        </Text>
        <CopyBtn value={value} />
      </View>
    </View>
  );
});

// ── Capture row inside a group ──

const CaptureRow = memo(function CaptureRow({ capture, expanded, onToggle }: { capture: InterceptCapture; expanded: boolean; onToggle: () => void }) {
  const ts = new Date(capture.ts).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const fields = parseBody(capture.reqBody) ?? [];
  const captureUrl = extractUrl(capture.reqBody);
  const credFields = fields.filter(f => fieldType(f.key) !== "normal");
  const otherFields = fields.filter(f => fieldType(f.key) === "normal");

  return (
    <View style={styles.captureRow}>
      <Pressable onPress={onToggle} style={({ pressed }) => [styles.captureRowHead, pressed && styles.pressed]}>
        <View style={styles.captureRowMeta}>
          <Text style={styles.captureTs}>{ts}</Text>
          <Text style={styles.captureMethod}>{capture.method}</Text>
          <Text style={styles.capturePath} numberOfLines={1}>{captureUrl ?? capture.path}</Text>
        </View>
        <View style={styles.captureRowRight}>
          {credFields.length > 0 && (
            <View style={styles.credCountBadge}>
              <ShieldAlert size={8} color={theme.colors.warn} />
              <Text style={styles.credCountText}>{credFields.length}</Text>
            </View>
          )}
          {expanded ? <ChevronDown size={12} color={theme.colors.textFaint} /> : <ChevronRight size={12} color={theme.colors.textFaint} />}
        </View>
      </Pressable>
      {expanded && (
        <View style={styles.captureDetail}>
          {fields.length > 0 ? (
            <View style={styles.tbl}>
              <View style={styles.tblHeader}>
                <Text style={[styles.tblHeaderCell, { flex: 1 }]}>FIELD</Text>
                <Text style={[styles.tblHeaderCell, { flex: 2 }]}>VALUE</Text>
              </View>
              {credFields.map(f => (<CredRow key={f.key} label={f.key} value={f.value} type={fieldType(f.key)} />))}
              {otherFields.map(f => (<CredRow key={f.key} label={f.key} value={f.value} type="normal" />))}
            </View>
          ) : (
            <View style={styles.captureRawBlock}>
              <Text style={styles.captureRawText} selectable>{capture.reqBody || "(empty body)"}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
});

// ── Group per proxy slug ──

function TargetGroup({ slug, captures }: { slug: string; captures: InterceptCapture[] }) {
  const [open, setOpen] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const allCreds = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ key: string; value: string }> = [];
    for (const c of captures) {
      const fields = parseBody(c.reqBody) ?? [];
      for (const f of fields) {
        if (fieldType(f.key) !== "normal" && !seen.has(f.key + "::" + f.value)) {
          seen.add(f.key + "::" + f.value);
          rows.push(f);
        }
      }
    }
    return rows;
  }, [captures]);

  const latestTs = new Date(Math.max(...captures.map(c => c.ts))).toLocaleString("en-AU", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  return (
    <View style={styles.targetGroup}>
      <Pressable onPress={() => setOpen(v => !v)} style={({ pressed }) => [styles.targetGroupHead, pressed && styles.pressed]}>
        <View style={styles.targetGroupLeft}>
          <ShieldAlert size={14} color={theme.colors.warn} />
          <View>
            <Text style={styles.targetSlug}>{slug}</Text>
            <Text style={styles.targetMeta}>{captures.length} capture{captures.length !== 1 ? "s" : ""} · last {latestTs}</Text>
          </View>
        </View>
        <View style={styles.targetGroupRight}>
          {allCreds.length > 0 && (
            <View style={styles.credCountBadge}>
              <Text style={styles.credCountText}>{allCreds.length} creds</Text>
            </View>
          )}
          {open ? <ChevronDown size={14} color={theme.colors.textFaint} /> : <ChevronRight size={14} color={theme.colors.textFaint} />}
        </View>
      </Pressable>
      {open && (
        <View style={styles.targetGroupBody}>
          {allCreds.length > 0 && (
            <View style={styles.credSummary}>
              <View style={styles.credSummaryHead}>
                <ShieldAlert size={11} color={theme.colors.warn} />
                <Text style={styles.credSummaryTitle}>CERTIFIED CREDENTIALS</Text>
              </View>
              <View style={styles.tbl}>
                <View style={styles.tblHeader}>
                  <Text style={[styles.tblHeaderCell, { flex: 1 }]}>FIELD</Text>
                  <Text style={[styles.tblHeaderCell, { flex: 2 }]}>VALUE</Text>
                </View>
                {allCreds.map((f, i) => (
                  <CredRow key={i} label={f.key} value={f.value} type={fieldType(f.key)} />
                ))}
              </View>
            </View>
          )}
          <View style={styles.captureList}>
            <Text style={styles.captureListTitle}>All requests ({captures.length})</Text>
            {[...captures].reverse().map(c => (
              <CaptureRow key={c.id} capture={c} expanded={expandedId === c.id} onToggle={() => setExpandedId(v => v === c.id ? null : c.id)} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Main screen ──

export default function InterceptsScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data, isLoading, isFetching, isError, error, dataUpdatedAt, refetch } = useIntercepts(ah);
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
      Math.max(...b[1].map(x => x.ts)) - Math.max(...a[1].map(x => x.ts))
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
    <View style={styles.root}>
      <LinearGradient colors={["rgba(255,178,62,0.12)", "transparent"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 0.5 }} style={styles.glow} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing(6) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrow}>INTERCEPT LAB</Text>
              {isFetching && !isLoading && <RefreshCw size={10} color={theme.colors.warn} />}
            </View>
            <View style={styles.heroRow}>
              <Text style={styles.hero}>Captures</Text>
              <View style={[styles.countBadge, captures.length > 0 && styles.countBadgeActive]}>
                <Text style={styles.countBadgeText}>{captures.length}</Text>
              </View>
            </View>
            {lastUpdated && <Text style={styles.liveTag}>LIVE · {lastUpdated}</Text>}
          </View>
        </View>

        {/* Quick actions row */}
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
          <View style={styles.stateCard}>
            <ActivityIndicator color={theme.colors.warn} />
            <Text style={styles.stateText}>Loading captures…</Text>
          </View>
        ) : captures.length === 0 ? (
          <View style={styles.stateCard}>
            <ShieldAlert size={32} color={theme.colors.textFaint} />
            <Text style={styles.stateText}>No captures yet.</Text>
            <Text style={styles.stateHint}>
              Toggle "Intercept" on a proxy target to start capturing credentials, forms, and request data from proxied traffic.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
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
        <View style={[styles.root, { paddingTop: insets.top + theme.spacing(4) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Har Replay Engine</Text>
            <Pressable onPress={() => setShowReplay(false)} style={({ pressed }) => [styles.modalClose, pressed && styles.pressed]}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalHint}>
              Paste a HAR (HTTP Archive) JSON blob and specify which proxy target to replay against. The engine sequentially executes every request, tracks cookies, and extracts tokens from the flow.
            </Text>
            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>PROXY SLUG</Text>
              <TextInput style={styles.modalInput} value={replaySlug} onChangeText={setReplaySlug} placeholder="e.g. my-target" placeholderTextColor={theme.colors.textFaint} autoCapitalize="none" autoCorrect={false} />
            </View>
            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>HAR JSON</Text>
              <TextInput style={[styles.modalInput, styles.modalInputLarge]} value={harPaste} onChangeText={setHarPaste} placeholder='Paste HAR JSON here ({"log":...})' placeholderTextColor={theme.colors.textFaint} multiline textAlignVertical="top" autoCapitalize="none" autoCorrect={false} />
            </View>
            <PressableScale onPress={runReplay} disabled={replay.isPending} haptic="medium" style={[styles.modalRunBtn, replay.isPending && { opacity: 0.5 }]}>
              {replay.isPending ? <ActivityIndicator color={theme.colors.bg} size="small" /> : <Play size={16} color={theme.colors.bg} />}
              <Text style={styles.modalRunText}>{replay.isPending ? "Replaying…" : "Run Replay"}</Text>
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
                        <CopyBtn value={t} />
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
  root: { flex: 1, backgroundColor: theme.colors.bg },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 280 },
  content: { paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(12), gap: theme.spacing(4) },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerLeft: { flex: 1, gap: theme.spacing(1) },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  heroRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  eyebrow: { color: theme.colors.warn, fontSize: 12, fontWeight: "700", letterSpacing: 2, fontFamily: theme.font.mono },
  hero: { color: theme.colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
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
  stateCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(6), gap: theme.spacing(3), alignItems: "center" },
  stateText: { color: theme.colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center" },
  stateHint: { color: theme.colors.textFaint, fontSize: 12, lineHeight: 18, textAlign: "center", fontFamily: theme.font.mono },
  errorText: { color: theme.colors.danger, fontSize: 14, fontFamily: theme.font.mono, textAlign: "center" },
  list: { gap: theme.spacing(3) },
  pressed: { opacity: 0.55 },
  copyIcon: { paddingTop: 2 },

  // Target group
  targetGroup: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  targetGroupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing(3), gap: theme.spacing(3) },
  targetGroupLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2.5), flex: 1 },
  targetGroupRight: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  targetSlug: { color: theme.colors.warn, fontSize: 14, fontWeight: "800", fontFamily: theme.font.mono },
  targetMeta: { color: theme.colors.textFaint, fontSize: 11, fontFamily: theme.font.mono, marginTop: 1 },
  credCountBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,178,62,0.15)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: "rgba(255,178,62,0.3)" },
  credCountText: { color: theme.colors.warn, fontSize: 10, fontWeight: "800", fontFamily: theme.font.mono },
  targetGroupBody: { borderTopWidth: 1, borderTopColor: theme.colors.border },

  // Credential summary
  credSummary: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  credSummaryHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), backgroundColor: "rgba(255,178,62,0.07)" },
  credSummaryTitle: { color: theme.colors.warn, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, fontFamily: theme.font.mono },

  // Table
  tbl: { overflow: "hidden" },
  tblHeader: { flexDirection: "row", backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(1.5), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tblHeaderCell: { color: theme.colors.textFaint, fontSize: 9, fontWeight: "800", letterSpacing: 1, fontFamily: theme.font.mono },
  tblRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)", gap: theme.spacing(2) },
  tblRowSens: { backgroundColor: "rgba(239,68,68,0.07)" },
  tblRowCred: { backgroundColor: "rgba(255,178,62,0.05)" },
  tblKeyCell: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing(1), flexWrap: "wrap" },
  tblBadge: { borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  tblBadgeSens: { backgroundColor: "rgba(239,68,68,0.3)" },
  tblBadgeCred: { backgroundColor: "rgba(255,178,62,0.3)" },
  tblBadgeText: { fontSize: 8, fontWeight: "800", fontFamily: theme.font.mono, color: theme.colors.text },
  tblKey: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono },
  tblValCell: { flex: 2, flexDirection: "row", alignItems: "flex-start", gap: theme.spacing(1.5) },
  tblVal: { color: theme.colors.text, fontSize: 13, fontFamily: theme.font.mono, flex: 1, lineHeight: 19 },
  tblValSens: { color: "#f87171", fontWeight: "700" },
  tblValCred: { color: theme.colors.warn, fontWeight: "700" },

  // Capture rows
  captureList: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  captureListTitle: { color: theme.colors.textFaint, fontSize: 9, fontWeight: "800", letterSpacing: 1, fontFamily: theme.font.mono, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(1.5), backgroundColor: theme.colors.bg },
  captureRow: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  captureRowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), gap: theme.spacing(2) },
  captureRowMeta: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), flex: 1 },
  captureTs: { color: theme.colors.textFaint, fontSize: 10, fontFamily: theme.font.mono },
  captureMethod: { color: theme.colors.accent, fontSize: 10, fontWeight: "700", fontFamily: theme.font.mono },
  capturePath: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, flex: 1 },
  captureRowRight: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  captureDetail: { backgroundColor: theme.colors.bg, borderTopWidth: 1, borderTopColor: theme.colors.border },
  captureRawBlock: { padding: theme.spacing(3) },
  captureRawText: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, lineHeight: 17 },

  // Modal
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" },
  modalClose: { paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(1.5), backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm },
  modalCloseText: { color: theme.colors.textDim, fontSize: 13, fontWeight: "600" },
  modalContent: { padding: theme.spacing(4), paddingBottom: theme.spacing(16), gap: theme.spacing(4) },
  modalHint: { color: theme.colors.textDim, fontSize: 13, lineHeight: 20, fontFamily: theme.font.mono },
  modalField: { gap: theme.spacing(1.5) },
  modalLabel: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, fontFamily: theme.font.mono },
  modalInput: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5), color: theme.colors.text, fontSize: 14, fontFamily: theme.font.mono },
  modalInputLarge: { minHeight: 140, paddingTop: theme.spacing(2.5) },
  modalRunBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2), backgroundColor: theme.colors.cyan, borderRadius: theme.radius.sm, paddingVertical: theme.spacing(3) },
  modalRunText: { color: theme.colors.bg, fontSize: 14, fontWeight: "800" },

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
