import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { Check, ChevronDown, ChevronRight, Copy, RefreshCw, ShieldAlert, Trash2 } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
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
import { useDeleteIntercepts, useIntercepts } from "@/hooks/useGateway";
import { useApiKey } from "@/hooks/useApiKey";
import { CREDENTIAL_FIELDS, SENSITIVE_FIELDS, type InterceptCapture } from "@/lib/api";

function parseBody(raw: string): Array<{ key: string; value: string }> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      // Handle {url, form:{...}} beacon shape
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
  const isCred = CREDENTIAL_FIELDS.some((f) => lower === f || lower.includes(f));
  const isSens = SENSITIVE_FIELDS.some((f) => lower.includes(f));
  if (isCred && isSens) return "sensitive";
  if (isCred) return "credential";
  return "normal";
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(value);
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  }, [value]);
  return (
    <Pressable onPress={copy} hitSlop={8} style={({ pressed }) => [styles.copyBtn, pressed && styles.pressed]}>
      {done ? <Check size={11} color={theme.colors.ok} /> : <Copy size={11} color={theme.colors.textFaint} />}
    </Pressable>
  );
}

// ── Simple credential table row ──
function CredRow({ label, value, type }: { label: string; value: string; type: "sensitive" | "credential" | "normal" }) {
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
}

// ── One row in the capture list inside a target group ──
function CaptureRow({ capture, expanded, onToggle }: { capture: InterceptCapture; expanded: boolean; onToggle: () => void }) {
  const ts = new Date(capture.ts).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const fields = parseBody(capture.reqBody) ?? [];
  const captureUrl = extractUrl(capture.reqBody);
  const credFields = fields.filter(f => fieldType(f.key) !== "normal");
  const otherFields = fields.filter(f => fieldType(f.key) === "normal");
  const hasData = fields.length > 0;

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
              <ShieldAlert size={9} color={theme.colors.warn} />
              <Text style={styles.credCountText}>{credFields.length}</Text>
            </View>
          )}
          {expanded
            ? <ChevronDown size={13} color={theme.colors.textFaint} />
            : <ChevronRight size={13} color={theme.colors.textFaint} />}
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.captureDetail}>
          {hasData ? (
            <View style={styles.tbl}>
              {/* Table header */}
              <View style={styles.tblHeader}>
                <Text style={[styles.tblHeaderCell, { flex: 1 }]}>FIELD</Text>
                <Text style={[styles.tblHeaderCell, { flex: 2 }]}>VALUE</Text>
              </View>
              {credFields.map(f => (
                <CredRow key={f.key} label={f.key} value={f.value} type={fieldType(f.key)} />
              ))}
              {otherFields.map(f => (
                <CredRow key={f.key} label={f.key} value={f.value} type="normal" />
              ))}
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
}

// ── All captures grouped under one target slug ──
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
      {/* Group header */}
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
          {open ? <ChevronDown size={15} color={theme.colors.textFaint} /> : <ChevronRight size={15} color={theme.colors.textFaint} />}
        </View>
      </Pressable>

      {open && (
        <View style={styles.targetGroupBody}>
          {/* Unique credentials summary table */}
          {allCreds.length > 0 && (
            <View style={styles.credSummary}>
              <View style={styles.credSummaryHead}>
                <ShieldAlert size={11} color={theme.colors.warn} />
                <Text style={styles.credSummaryTitle}>UNIQUE CREDENTIALS CAPTURED</Text>
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

          {/* Individual capture rows */}
          <View style={styles.captureList}>
            <Text style={styles.captureListTitle}>ALL REQUESTS ({captures.length})</Text>
            {[...captures].reverse().map(c => (
              <CaptureRow
                key={c.id}
                capture={c}
                expanded={expandedId === c.id}
                onToggle={() => setExpandedId(v => v === c.id ? null : c.id)}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export default function InterceptsScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data, isLoading, isFetching, isError, error, dataUpdatedAt } = useIntercepts(ah);
  const deleteAll = useDeleteIntercepts(ah);

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
    if (Platform.OS === "web") {
      run();
      return;
    }
    Alert.alert("Clear all captures", "Permanently delete all intercept captures?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear all", style: "destructive", onPress: run },
    ]);
  }, [deleteAll]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["rgba(255,178,62,0.14)", "transparent"]}
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
          <View style={styles.headerLeft}>
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrow}>INTERCEPT LAB</Text>
              {isFetching && !isLoading && (
                <RefreshCw size={11} color={theme.colors.warn} />
              )}
            </View>
            <View style={styles.heroRow}>
              <Text style={styles.hero}>Captures</Text>
              <View style={[styles.countBadge, captures.length > 0 && styles.countBadgeActive]}>
                <Text style={styles.countBadgeText}>{captures.length}</Text>
              </View>
            </View>
            {lastUpdated && (
              <Text style={styles.liveTag}>LIVE · {lastUpdated}</Text>
            )}
          </View>
          {captures.length > 0 ? (
            <Pressable
              onPress={wipe}
              disabled={deleteAll.isPending}
              style={({ pressed }) => [
                styles.clearBtn,
                pressed && styles.pressed,
              ]}
            >
              <Trash2 size={15} color={theme.colors.danger} />
              <Text style={styles.clearText}>
                {deleteAll.isPending ? "Clearing…" : "Clear all"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {isError ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>
              {error?.message ?? "Could not load intercept captures."}
            </Text>
          </View>
        ) : isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={theme.colors.warn} />
            <Text style={styles.stateText}>Loading captures…</Text>
          </View>
        ) : captures.length === 0 ? (
          <View style={styles.stateCard}>
            <ShieldAlert size={28} color={theme.colors.textFaint} />
            <Text style={styles.stateText}>
              No captures yet.
            </Text>
            <Text style={styles.stateHint}>
              Enable intercept lab mode in your Worker settings, then toggle
              "Intercept" on a proxy target. Proxied traffic through that target
              will appear here with masked sensitive values.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {grouped.map(([slug, caps]) => (
              <TargetGroup key={slug} slug={slug} captures={caps} />
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
  content: { paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(12), gap: theme.spacing(4) },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: theme.spacing(3) },
  headerLeft: { flex: 1, gap: theme.spacing(1) },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  heroRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  eyebrow: { color: theme.colors.warn, fontSize: 12, fontWeight: "700", letterSpacing: 2, fontFamily: theme.font.mono },
  hero: { color: theme.colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  countBadge: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, paddingHorizontal: theme.spacing(2), paddingVertical: 2, borderWidth: 1, borderColor: theme.colors.border },
  countBadgeActive: { backgroundColor: "rgba(255,178,62,0.15)", borderColor: "rgba(255,178,62,0.4)" },
  countBadgeText: { color: theme.colors.warn, fontSize: 12, fontWeight: "800", fontFamily: theme.font.mono },
  liveTag: { color: theme.colors.warn, fontSize: 10, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono, opacity: 0.7 },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.danger, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), marginTop: theme.spacing(1) },
  clearText: { color: theme.colors.danger, fontSize: 12, fontWeight: "700" },
  stateCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(6), gap: theme.spacing(3), alignItems: "center" },
  stateText: { color: theme.colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center" },
  stateHint: { color: theme.colors.textFaint, fontSize: 12, lineHeight: 18, textAlign: "center", fontFamily: theme.font.mono },
  errorText: { color: theme.colors.danger, fontSize: 14, fontFamily: theme.font.mono, textAlign: "center" },
  list: { gap: theme.spacing(3) },
  pressed: { opacity: 0.55 },
  copyBtn: { paddingTop: 2 },

  // ── Target group (per-slug section) ──
  targetGroup: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  targetGroupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing(3), gap: theme.spacing(3) },
  targetGroupLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2.5), flex: 1 },
  targetGroupRight: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  targetSlug: { color: theme.colors.warn, fontSize: 14, fontWeight: "800", fontFamily: theme.font.mono },
  targetMeta: { color: theme.colors.textFaint, fontSize: 11, fontFamily: theme.font.mono, marginTop: 1 },
  credCountBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,178,62,0.15)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: "rgba(255,178,62,0.3)" },
  credCountText: { color: theme.colors.warn, fontSize: 10, fontWeight: "800", fontFamily: theme.font.mono },
  targetGroupBody: { borderTopWidth: 1, borderTopColor: theme.colors.border },

  // ── Credential summary table ──
  credSummary: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  credSummaryHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), backgroundColor: "rgba(255,178,62,0.07)" },
  credSummaryTitle: { color: theme.colors.warn, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, fontFamily: theme.font.mono },

  // ── Generic table ──
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

  // ── Individual capture rows ──
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
});
