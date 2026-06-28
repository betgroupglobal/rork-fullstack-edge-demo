import { Play, Square, Trash2 } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/constants/theme";
import { useStartTunnel, useStopTunnel, useDeleteTunnel } from "@/hooks/useGateway";
import type { ProxyTunnel } from "@/lib/api";

type TunnelRowProps = { tunnel: ProxyTunnel; authHeader: string | undefined };

/** Single tunnel row with start/stop/delete actions. */
export default function TunnelRow({ tunnel, authHeader }: TunnelRowProps) {
  const start = useStartTunnel(authHeader);
  const stop = useStopTunnel(authHeader);
  const remove = useDeleteTunnel(authHeader);

  const fmtBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        <View style={styles.top}>
          <View
            style={[
              styles.dot,
              tunnel.status === "running"
                ? styles.dotRun
                : tunnel.status === "error"
                  ? styles.dotErr
                  : styles.dotStop,
            ]}
          />
          <Text style={styles.name} numberOfLines={1}>
            {tunnel.name}
          </Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.detail}>
            {tunnel.type}:{tunnel.remotePort} → {tunnel.localHost}:
            {tunnel.localPort}
          </Text>
          <Text style={styles.stats}>
            {fmtBytes(tunnel.bytesIn + tunnel.bytesOut)} · {tunnel.activeConns}{" "}
            conns
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {tunnel.status === "stopped" || tunnel.status === "error" ? (
          <Pressable
            onPress={() => start.mutate(tunnel.id)}
            disabled={start.isPending}
            style={({ pressed }) => [
              styles.btn,
              styles.btnStart,
              pressed && styles.pressed,
            ]}
          >
            <Play size={12} color={theme.colors.ok} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => stop.mutate(tunnel.id)}
            disabled={stop.isPending}
            style={({ pressed }) => [
              styles.btn,
              styles.btnStop,
              pressed && styles.pressed,
            ]}
          >
            <Square size={11} color={theme.colors.warn} />
          </Pressable>
        )}
        <Pressable
          onPress={() => remove.mutate(tunnel.id)}
          disabled={remove.isPending}
          style={({ pressed }) => [
            styles.btn,
            styles.btnDel,
            pressed && styles.pressed,
          ]}
        >
          <Trash2 size={12} color={theme.colors.danger} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing(2),
  },
  info: { flex: 1, gap: theme.spacing(1) },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotRun: { backgroundColor: theme.colors.ok },
  dotStop: { backgroundColor: theme.colors.textFaint },
  dotErr: { backgroundColor: theme.colors.danger },
  name: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  meta: { flexDirection: "row", gap: theme.spacing(2) },
  detail: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontFamily: theme.font.mono,
  },
  stats: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontFamily: theme.font.mono,
  },
  actions: { flexDirection: "row", gap: theme.spacing(1.5) },
  btn: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  btnStart: {
    borderColor: theme.colors.ok,
    backgroundColor: "rgba(60,224,138,0.10)",
  },
  btnStop: {
    borderColor: theme.colors.warn,
    backgroundColor: "rgba(255,178,62,0.10)",
  },
  btnDel: {
    borderColor: theme.colors.danger,
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  pressed: { opacity: 0.55 },
});
