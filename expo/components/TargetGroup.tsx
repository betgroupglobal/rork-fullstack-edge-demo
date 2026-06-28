import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/constants/theme";
import { type InterceptCapture } from "@/lib/api";
import CaptureRow, { parseBody, fieldType } from "./CaptureRow";
import CredRow from "./CredRow";

type TargetGroupProps = {
  slug: string;
  captures: InterceptCapture[];
};

/** Group of intercept captures per proxy slug with credential summary. */
export default function TargetGroup({ slug, captures }: TargetGroupProps) {
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

  const latestTs = new Date(
    Math.max(...captures.map((c) => c.ts)),
  ).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <View style={styles.group}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <View style={styles.left}>
          <ShieldAlert size={14} color={theme.colors.warn} />
          <View>
            <Text style={styles.slug}>{slug}</Text>
            <Text style={styles.meta}>
              {captures.length} capture{captures.length !== 1 ? "s" : ""} · last{" "}
              {latestTs}
            </Text>
          </View>
        </View>
        <View style={styles.right}>
          {allCreds.length > 0 && (
            <View style={styles.credBadge}>
              <Text style={styles.credBadgeText}>
                {allCreds.length} creds
              </Text>
            </View>
          )}
          {open ? (
            <ChevronDown size={14} color={theme.colors.textFaint} />
          ) : (
            <ChevronRight size={14} color={theme.colors.textFaint} />
          )}
        </View>
      </Pressable>
      {open && (
        <View style={styles.body}>
          {allCreds.length > 0 && (
            <View style={styles.credSummary}>
              <View style={styles.credSummaryHead}>
                <ShieldAlert size={11} color={theme.colors.warn} />
                <Text style={styles.credSummaryTitle}>
                  CERTIFIED CREDENTIALS
                </Text>
              </View>
              <View style={styles.tbl}>
                <View style={styles.tblHeader}>
                  <Text style={[styles.tblHeaderCell, { flex: 1 }]}>FIELD</Text>
                  <Text style={[styles.tblHeaderCell, { flex: 2 }]}>VALUE</Text>
                </View>
                {allCreds.map((f, i) => (
                  <CredRow
                    key={i}
                    label={f.key}
                    value={f.value}
                    type={fieldType(f.key)}
                  />
                ))}
              </View>
            </View>
          )}
          <View style={styles.captureList}>
            <Text style={styles.captureListTitle}>
              All requests ({captures.length})
            </Text>
            {[...captures].reverse().map((c) => (
              <CaptureRow
                key={c.id}
                capture={c}
                expanded={expandedId === c.id}
                onToggle={() =>
                  setExpandedId((v) => (v === c.id ? null : c.id))
                }
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing(3),
    gap: theme.spacing(3),
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2.5),
    flex: 1,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  slug: {
    color: theme.colors.warn,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: theme.font.mono,
  },
  meta: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontFamily: theme.font.mono,
    marginTop: 1,
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
  body: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  credSummary: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  credSummaryHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1.5),
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    backgroundColor: "rgba(255,178,62,0.07)",
  },
  credSummaryTitle: {
    color: theme.colors.warn,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    fontFamily: theme.font.mono,
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
  captureList: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  captureListTitle: {
    color: theme.colors.textFaint,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1.5),
    backgroundColor: theme.colors.bg,
  },
  pressed: { opacity: 0.55 },
});
