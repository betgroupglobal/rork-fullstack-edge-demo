import { LinearGradient } from "expo-linear-gradient";
import { Bug, Eye, EyeOff, ShieldAlert, Trash2 } from "lucide-react-native";
import React, { useCallback, useState } from "react";
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
import { maskValue, SENSITIVE_FIELDS, type InterceptCapture } from "@/lib/api";

/** Mask the body of a capture by hiding values of known sensitive fields. */
function maskBody(raw: string): string {
  if (!raw) return raw;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const lower = k.toLowerCase();
      if (SENSITIVE_FIELDS.some((f) => lower.includes(f)) && typeof v === "string") {
        obj[k] = maskValue(v);
      }
    }
    return JSON.stringify(obj, null, 2);
  } catch {
    return raw;
  }
}

function CaptureCard({ capture }: { capture: InterceptCapture }) {
  const [showReq, setShowReq] = useState<boolean>(false);
  const [showResp, setShowResp] = useState<boolean>(false);
  const [showHeaders, setShowHeaders] = useState<boolean>(false);

  const elapsed = Math.max(0, Math.round((Date.now() - capture.ts) / 1000));
  const elapsedStr =
    elapsed < 60
      ? `${elapsed}s ago`
      : elapsed < 3600
        ? `${Math.round(elapsed / 60)}m ago`
        : `${Math.round(elapsed / 3600)}h ago`;

  const statusColor =
    capture.respStatus < 300
      ? theme.colors.ok
      : capture.respStatus < 400
        ? theme.colors.accent
        : theme.colors.danger;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleWrap}>
          <Bug size={14} color={theme.colors.warn} />
          <Text style={styles.cardTitle} numberOfLines={1}>
            {capture.method} {capture.path}
          </Text>
        </View>
        <Text style={[styles.status, { color: statusColor }]}>
          {capture.respStatus}
        </Text>
      </View>

      <View style={styles.meta}>
        <Text style={styles.slugTag}>{capture.slug}</Text>
        <Text style={styles.hostTag}>{capture.host}</Text>
        <Text style={styles.tsTag}>{elapsedStr}</Text>
      </View>

      <Pressable
        onPress={() => setShowHeaders((v) => !v)}
        style={({ pressed }) => [styles.sectionBtn, pressed && styles.pressed]}
      >
        <Text style={styles.sectionLabel}>
          {showHeaders ? "Hide" : "Show"} request / response headers
        </Text>
      </Pressable>
      {showHeaders ? (
        <>
          <Text style={styles.codeLabel}>REQUEST HEADERS</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              {capture.reqHeaders
                ? JSON.stringify(JSON.parse(capture.reqHeaders), null, 2)
                : "(none)"}
            </Text>
          </View>
          <Text style={styles.codeLabel}>RESPONSE HEADERS</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              {capture.respHeaders
                ? JSON.stringify(JSON.parse(capture.respHeaders), null, 2)
                : "(none)"}
            </Text>
          </View>
        </>
      ) : null}

      <Pressable
        onPress={() => setShowReq((v) => !v)}
        style={({ pressed }) => [styles.sectionBtn, pressed && styles.pressed]}
      >
        {showReq ? (
          <EyeOff size={13} color={theme.colors.warn} />
        ) : (
          <Eye size={13} color={theme.colors.warn} />
        )}
        <Text style={[styles.sectionLabel, { color: theme.colors.warn }]}>
          {showReq ? "Hide" : "Reveal"} request body (masked)
        </Text>
      </Pressable>
      {showReq ? (
        <View style={styles.codeBlock}>
          <Text style={styles.codeText} selectable>
            {capture.reqBody ? maskBody(capture.reqBody) : "(empty)"}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => setShowResp((v) => !v)}
        style={({ pressed }) => [styles.sectionBtn, pressed && styles.pressed]}
      >
        {showResp ? (
          <EyeOff size={13} color={theme.colors.warn} />
        ) : (
          <Eye size={13} color={theme.colors.warn} />
        )}
        <Text style={[styles.sectionLabel, { color: theme.colors.warn }]}>
          {showResp ? "Hide" : "Reveal"} response body (masked)
        </Text>
      </Pressable>
      {showResp ? (
        <View style={styles.codeBlock}>
          <Text style={styles.codeText} selectable>
            {capture.respBody ? maskBody(capture.respBody) : "(empty)"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function InterceptsScreen() {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, error } = useIntercepts();
  const deleteAll = useDeleteIntercepts();

  const captures = data ?? [];

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
          <View>
            <Text style={styles.eyebrow}>INTERCEPT LAB</Text>
            <Text style={styles.hero}>Captures</Text>
            <Text style={styles.sub}>
              Proxied request/response payloads when intercept mode is enabled
              for a target. Sensitive values are masked — tap to reveal.
            </Text>
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

        <Text style={styles.sectionTitle}>
          CAPTURES · {captures.length}
        </Text>

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
            {captures.map((c) => (
              <CaptureCard key={c.id} capture={c} />
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
    height: 280,
  },
  content: {
    paddingHorizontal: theme.spacing(5),
    paddingBottom: theme.spacing(12),
    gap: theme.spacing(5),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spacing(3),
  },
  eyebrow: {
    color: theme.colors.warn,
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
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2.5),
    marginTop: theme.spacing(1),
  },
  clearText: {
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: "700",
  },
  sectionTitle: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontFamily: theme.font.mono,
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
  list: {
    gap: theme.spacing(3),
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
  },
  cardTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    flex: 1,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: theme.font.mono,
    flexShrink: 1,
  },
  status: {
    fontSize: 14,
    fontWeight: "800",
    fontFamily: theme.font.mono,
  },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(2),
  },
  slugTag: {
    color: theme.colors.warn,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: theme.font.mono,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
  },
  hostTag: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontFamily: theme.font.mono,
  },
  tsTag: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontFamily: theme.font.mono,
    marginLeft: "auto",
  },
  sectionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(1),
  },
  sectionLabel: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: theme.font.mono,
  },
  codeBlock: {
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
  },
  codeLabel: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
    marginTop: theme.spacing(1),
  },
  codeText: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontFamily: theme.font.mono,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.6,
  },
});
