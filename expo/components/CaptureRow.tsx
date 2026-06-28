import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react-native";
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/constants/theme";
import { CREDENTIAL_FIELDS, SENSITIVE_FIELDS, type InterceptCapture } from "@/lib/api";
import CredRow from "./CredRow";

// ── Body parsing helpers ──

function parseBody(
  raw: string,
): Array<{ key: string; value: string }> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const rec = obj as Record<string, unknown>;
      const inner = rec.form ?? rec.data ?? rec;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return Object.entries(inner as Record<string, unknown>).map(
          ([key, value]) => ({
            key,
            value: typeof value === "string" ? value : JSON.stringify(value),
          }),
        );
      }
    }
  } catch {
    /* not JSON */
  }
  if (raw.includes("=")) {
    try {
      const params = new URLSearchParams(raw);
      const result: Array<{ key: string; value: string }> = [];
      params.forEach((v, k) => result.push({ key: k, value: v }));
      if (result.length > 0) return result;
    } catch {
      /* not URL-encoded */
    }
  }
  return null;
}

function extractUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj.url === "string" ? obj.url : null;
  } catch {
    return null;
  }
}

function fieldType(key: string): "credential" | "sensitive" | "normal" {
  const lower = key.toLowerCase();
  if (CREDENTIAL_FIELDS.has(lower)) return "credential";
  if (SENSITIVE_FIELDS.has(lower)) return "sensitive";
  for (const f of CREDENTIAL_FIELDS) {
    if (lower.includes(f))
      return SENSITIVE_FIELDS.has(f) ? "sensitive" : "credential";
  }
  return "normal";
}

// ── Component ──

type CaptureRowProps = {
  capture: InterceptCapture;
  expanded: boolean;
  onToggle: () => void;
};

const CaptureRow = memo(function CaptureRow({
  capture,
  expanded,
  onToggle,
}: CaptureRowProps) {
  const ts = new Date(capture.ts).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const fields = parseBody(capture.reqBody) ?? [];
  const captureUrl = extractUrl(capture.reqBody);
  const credFields = fields.filter((f) => fieldType(f.key) !== "normal");
  const otherFields = fields.filter((f) => fieldType(f.key) === "normal");

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <View style={styles.meta}>
          <Text style={styles.ts}>{ts}</Text>
          <Text style={styles.method}>{capture.method}</Text>
          <Text style={styles.path} numberOfLines={1}>
            {captureUrl ?? capture.path}
          </Text>
        </View>
        <View style={styles.right}>
          {credFields.length > 0 && (
            <View style={styles.credBadge}>
              <ShieldAlert size={8} color={theme.colors.warn} />
              <Text style={styles.credBadgeText}>{credFields.length}</Text>
            </View>
          )}
          {expanded ? (
            <ChevronDown size={12} color={theme.colors.textFaint} />
          ) : (
            <ChevronRight size={12} color={theme.colors.textFaint} />
          )}
        </View>
      </Pressable>
      {expanded && (
        <View style={styles.detail}>
          {fields.length > 0 ? (
            <View style={styles.tbl}>
              <View style={styles.tblHeader}>
                <Text style={[styles.tblHeaderCell, { flex: 1 }]}>FIELD</Text>
                <Text style={[styles.tblHeaderCell, { flex: 2 }]}>VALUE</Text>
              </View>
              {credFields.map((f) => (
                <CredRow
                  key={f.key}
                  label={f.key}
                  value={f.value}
                  type={fieldType(f.key)}
                />
              ))}
              {otherFields.map((f) => (
                <CredRow
                  key={f.key}
                  label={f.key}
                  value={f.value}
                  type="normal"
                />
              ))}
            </View>
          ) : (
            <View style={styles.rawBlock}>
              <Text style={styles.rawText} selectable>
                {capture.reqBody || "(empty body)"}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
});

export default CaptureRow;
export { parseBody, extractUrl, fieldType };

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    gap: theme.spacing(2),
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    flex: 1,
  },
  ts: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontFamily: theme.font.mono,
  },
  method: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: theme.font.mono,
  },
  path: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontFamily: theme.font.mono,
    flex: 1,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1.5),
  },
  credBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,178,62,0.15)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(255,178,62,0.3)",
  },
  credBadgeText: {
    color: theme.colors.warn,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: theme.font.mono,
  },
  detail: {
    backgroundColor: theme.colors.bg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  tbl: { overflow: "hidden" },
  tblHeader: {
    flexDirection: "row",
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tblHeaderCell: {
    color: theme.colors.textFaint,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
  },
  rawBlock: { padding: theme.spacing(3) },
  rawText: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontFamily: theme.font.mono,
    lineHeight: 17,
  },
  pressed: { opacity: 0.55 },
});
