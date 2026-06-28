import { LinearGradient } from "expo-linear-gradient";
import { Loader, Network, Server, Play, Square, Cpu, FileText, RefreshCw } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import ProxyCard from "@/components/ProxyCard";
import FocusInput from "@/components/FocusInput";
import { SkeletonCard } from "@/components/SkeletonBlock";
import EmptyState from "@/components/EmptyState";
import { layout, card, type as typeStyles, form, list } from "@/constants/styles";
import { theme } from "@/constants/theme";
import { useApiKey } from "@/hooks/useApiKey";
import { useCreateProxy, useProxies, useServers, useLaunchServer, useStopServer, useConfigureServer, useServerLogs } from "@/hooks/useGateway";

export default function ProxiesScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data, isLoading, isError, error, refetch, isFetching } = useProxies();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);
  const createProxy = useCreateProxy(ah);

  // Server launch management
  const { data: serversData } = useServers();
  const launchSvr = useLaunchServer(ah);
  const stopSvr = useStopServer(ah);
  const aiConfigure = useConfigureServer(ah);
  const fetchLogs = useServerLogs(ah);

  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Server launch form
  const [svrName, setSvrName] = useState("");
  const [svrPort, setSvrPort] = useState("12000");
  const [svrTarget, setSvrTarget] = useState("");
  const [svrConfig, setSvrConfig] = useState<string | null>(null);
  const [svrError, setSvrError] = useState<string | null>(null);
  const [showLogsFor, setShowLogsFor] = useState<number | null>(null);

  const servers = serversData?.data ?? [];

  const submit = useCallback(() => {
    const trimmedUrl = targetUrl.trim();
    if (!trimmedUrl) { setFormError("Enter a target domain."); return; }
    const normalised = /^https?:\/\//.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
    setFormError(null);
    createProxy.mutate(
      { name: name.trim(), targetUrl: normalised },
      { onSuccess: () => { setName(""); setTargetUrl(""); }, onError: (err) => setFormError(err.message) },
    );
  }, [name, targetUrl, createProxy]);

  const proxies = data ?? [];
  const activeCount = proxies.filter((p) => p.enabled).length;

  // ── Server launch handlers ──
  const handleLaunchServer = useCallback(() => {
    const portNum = parseInt(svrPort, 10);
    if (!portNum || portNum < 1000) { setSvrError("Enter a valid port (≥1000)."); return; }
    if (!svrTarget.trim()) { setSvrError("Enter a target host for the proxy server."); return; }
    setSvrError(null);

    const tunnels = [{
      name: svrTarget.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 30),
      type: "http" as const,
      localPort: 8787,
      remotePort: portNum + 100,
    }];

    launchSvr.mutate(
      { name: svrName.trim() || `proxy-server-${svrTarget.slice(0, 20)}`, port: portNum, config: svrConfig ?? undefined, tunnels },
      { onSuccess: () => { setSvrName(""); setSvrTarget(""); setSvrConfig(null); }, onError: (err) => setSvrError(err.message) },
    );
  }, [svrName, svrPort, svrTarget, svrConfig, launchSvr]);

  const handleAiConfigure = useCallback(() => {
    if (!svrTarget.trim()) { setSvrError("Enter a target host first."); return; }
    setSvrError(null);
    aiConfigure.mutate(
      { targetHost: svrTarget.trim(), ports: [parseInt(svrPort, 10) || 12000], tunnelCount: 1 },
      { onSuccess: (result) => { setSvrConfig(result.config); }, onError: (err) => setSvrError(err.message) },
    );
  }, [svrTarget, svrPort, aiConfigure]);

  const handleStopServer = useCallback((id: number) => {
    stopSvr.mutate(id);
  }, [stopSvr]);

  const handleShowLogs = useCallback((id: number) => {
    if (showLogsFor === id) { setShowLogsFor(null); return; }
    fetchLogs.mutate(id, { onSuccess: (logs) => { setShowLogsFor(id); } });
  }, [showLogsFor, fetchLogs]);

  return (
    <View style={layout.root}>
      <LinearGradient colors={[theme.colors.accentGlow, "transparent"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 0.5 }} style={[layout.glow, { height: 320 }]} pointerEvents="none" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[layout.content, { paddingTop: insets.top + theme.spacing(6) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
            />
          }
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={typeStyles.eyebrow}>EDGE PROXIES</Text>
              <Text style={typeStyles.hero}>Route any domain</Text>
              <Text style={typeStyles.sub}>Add a target and it goes live instantly. Every request captured for the analyser.</Text>
            </View>
            {proxies.length > 0 && (
              <View style={styles.statsCol}>
                <View style={[styles.statPill, styles.statPillTotal]}>
                  <Text style={styles.statNum}>{proxies.length}</Text>
                  <Text style={styles.statPillLabel}>total</Text>
                </View>
                <View style={[styles.statPill, activeCount > 0 ? styles.statPillActive : styles.statPillOff]}>
                  <Text style={[styles.statNum, activeCount > 0 && { color: theme.colors.ok }]}>{activeCount}</Text>
                  <Text style={[styles.statPillLabel, activeCount > 0 && { color: theme.colors.ok }]}>active</Text>
                </View>
              </View>
            )}
          </View>

          {/* Create form */}
          <View style={card.elevated}>
            <Text style={form.label}>TARGET DOMAIN</Text>
            <FocusInput
              value={targetUrl} onChangeText={setTargetUrl} placeholder="https://api.example.com"
              placeholderTextColor={theme.colors.textFaint} style={form.input}
              autoCapitalize="none" autoCorrect={false} keyboardType="url" onSubmitEditing={submit}
            />
            <Text style={[form.label, { marginTop: theme.spacing(1) }]}>NAME (optional)</Text>
            <FocusInput
              value={name} onChangeText={setName} placeholder="e.g. Example API"
              placeholderTextColor={theme.colors.textFaint} style={form.input} autoCapitalize="none"
            />
            {formError ? <Text style={form.error}>{formError}</Text> : null}
            <PressableScale haptic="heavy" onPress={submit} disabled={createProxy.isPending} style={[form.submitBtn, createProxy.isPending && { opacity: 0.7 }]}>
              {createProxy.isPending ? <Loader size={16} color={theme.colors.bg} /> : <Network size={16} color={theme.colors.bg} />}
              <Text style={form.submitText}>{createProxy.isPending ? "Deploying…" : "Deploy proxy"}</Text>
            </PressableScale>
          </View>

          {/* Proxy list */}
          {isError ? (
            <OfflineCard message={error?.message ?? "Could not load proxy targets."} onRetry={() => refetch()} />
          ) : isLoading ? (
            <View style={list.gap}>
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i} height={140} />
              ))}
            </View>
          ) : proxies.length === 0 ? (
            <EmptyState
              icon={<Network size={26} color={theme.colors.accent} />}
              title="No targets yet"
              subtitle="Add a domain above to start routing traffic through the gateway."
            />
          ) : (
            <View style={list.gap}>
              <Text style={typeStyles.sectionTitle}>TARGETS · {proxies.length}</Text>
              {proxies.map((proxy) => (
                <ProxyCard key={proxy.id} proxy={proxy} authHeader={ah} />
              ))}
            </View>
          )}

          {/* ── Server Launch Management (Grok Build 0.1) ── */}
          <View style={styles.sectionDivider} />

          <View style={styles.serverHeaderRow}>
            <View style={styles.serverHeaderLeft}>
              <Text style={typeStyles.eyebrow}>PROXY SERVERS</Text>
              <Text style={typeStyles.hero}>Launch tunnel hosts</Text>
              <Text style={typeStyles.sub}>Spin up dedicated proxy server instances. Grok Build 0.1 generates the optimal config.</Text>
            </View>
            {servers.length > 0 && (
              <View style={styles.serverBadge}>
                <View style={styles.serverBadgeDot} />
                <Text style={styles.serverBadgeText}>{servers.filter((s) => s.status === "running").length} running</Text>
              </View>
            )}
          </View>

          {/* Launch form */}
          <View style={card.elevated}>
            <Text style={form.label}>TARGET HOST</Text>
            <FocusInput
              value={svrTarget} onChangeText={setSvrTarget} placeholder="api.example.com"
              placeholderTextColor={theme.colors.textFaint} style={form.input}
              autoCapitalize="none" autoCorrect={false}
            />
            <View style={styles.serverFormRow}>
              <View style={{ flex: 1 }}>
                <Text style={form.label}>NAME</Text>
                <FocusInput
                  value={svrName} onChangeText={setSvrName} placeholder="e.g. prod-vpn"
                  placeholderTextColor={theme.colors.textFaint} style={form.input}
                  autoCapitalize="none"
                />
              </View>
              <View style={{ width: 100 }}>
                <Text style={form.label}>PORT</Text>
                <FocusInput
                  value={svrPort} onChangeText={setSvrPort} placeholder="12000"
                  placeholderTextColor={theme.colors.textFaint} style={form.input}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            {svrConfig ? (
              <View style={styles.configPreview}>
                <Text style={styles.configLabel}>Generated config (Grok Build 0.1)</Text>
                <Text style={styles.configText} numberOfLines={6}>{svrConfig}</Text>
              </View>
            ) : null}

            {svrError ? <Text style={form.error}>{svrError}</Text> : null}

            <View style={styles.serverBtnRow}>
              <PressableScale haptic="light" onPress={handleAiConfigure} disabled={aiConfigure.isPending} style={[styles.serverBtn, styles.serverBtnAi]}>
                {aiConfigure.isPending ? <Loader size={14} color={theme.colors.accent} /> : <Cpu size={14} color={theme.colors.accent} />}
                <Text style={styles.serverBtnAiText}>{aiConfigure.isPending ? "Generating…" : "Grok config"}</Text>
              </PressableScale>
              <PressableScale haptic="heavy" onPress={handleLaunchServer} disabled={launchSvr.isPending} style={[styles.serverBtn, styles.serverBtnLaunch]}>
                {launchSvr.isPending ? <Loader size={14} color={theme.colors.bg} /> : <Play size={14} color={theme.colors.bg} />}
                <Text style={styles.serverBtnLaunchText}>{launchSvr.isPending ? "Launching…" : "Launch server"}</Text>
              </PressableScale>
            </View>
          </View>

          {/* Running servers list */}
          {servers.length > 0 && (
            <View style={list.gap}>
              <Text style={typeStyles.sectionTitle}>INSTANCES · {servers.length}</Text>
              {servers.map((srv) => (
                <View key={srv.id} style={card.surface}>
                  <View style={styles.serverRow}>
                    <View style={styles.serverInfo}>
                      <View style={styles.serverNameRow}>
                        <View style={[styles.statusDot, srv.status === "running" ? styles.statusRunning : srv.status === "launching" ? styles.statusLaunching : styles.statusStopped]} />
                        <Text style={styles.serverName} numberOfLines={1}>{srv.name}</Text>
                      </View>
                      <Text style={styles.serverMeta}>Port {srv.port} · PID {srv.pid || "—"} · {srv.tunnelCount} tunnels</Text>
                      {srv.status === "running" ? (
                        <Text style={styles.serverUptime}>Up {(srv.uptime ?? 0) < 120 ? `${srv.uptime ?? 0}s` : `${Math.round((srv.uptime ?? 0) / 60)}m`}{srv.health ? ` · ${srv.health.status}` : ""}</Text>
                      ) : (
                        <Text style={[styles.serverUptime, { color: srv.status === "crashed" ? theme.colors.danger : theme.colors.warn }]}>{srv.status}</Text>
                      )}
                    </View>
                    <View style={styles.serverActions}>
                      <PressableScale haptic="light" onPress={() => handleShowLogs(srv.id)} style={styles.serverIconBtn}>
                        <FileText size={16} color={theme.colors.textDim} />
                      </PressableScale>
                      {(srv.status === "running" || srv.status === "degraded") && (
                        <PressableScale haptic="medium" onPress={() => handleStopServer(srv.id)} disabled={stopSvr.isPending} style={[styles.serverIconBtn, styles.serverIconBtnStop]}>
                          <Square size={14} color={theme.colors.danger} />
                        </PressableScale>
                      )}
                    </View>
                  </View>
                  {showLogsFor === srv.id && fetchLogs.data ? (
                    <View style={styles.logPanel}>
                      <Text style={styles.logText}>{fetchLogs.data.slice(-2000)}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing(3) },
  headerLeft: { flex: 1 },
  statsCol: { flexDirection: "column", gap: theme.spacing(1.5), alignItems: "flex-end" },
  statPill: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), borderRadius: theme.radius.sm, borderWidth: 1, paddingHorizontal: theme.spacing(2.5), paddingVertical: theme.spacing(1) },
  statPillTotal: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
  statPillActive: { backgroundColor: "rgba(60,224,138,0.08)", borderColor: "rgba(60,224,138,0.35)" },
  statPillOff: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: 0.5 },
  statNum: { color: theme.colors.text, fontSize: 16, fontWeight: "800", fontFamily: theme.font.mono },
  statPillLabel: { color: theme.colors.textDim, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, fontFamily: theme.font.mono },
  // Server launch management
  sectionDivider: { height: theme.spacing(5) },
  serverHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing(3), marginBottom: theme.spacing(2) },
  serverHeaderLeft: { flex: 1 },
  serverBadge: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), backgroundColor: "rgba(60,224,138,0.1)", borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing(2.5), paddingVertical: theme.spacing(1), borderWidth: 1, borderColor: "rgba(60,224,138,0.25)" },
  serverBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.ok },
  serverBadgeText: { color: theme.colors.ok, fontSize: 11, fontWeight: "700", fontFamily: theme.font.mono },
  serverFormRow: { flexDirection: "row", gap: theme.spacing(2.5), marginTop: theme.spacing(1) },
  configPreview: { marginTop: theme.spacing(2), backgroundColor: "rgba(16,18,22,0.8)", borderRadius: theme.radius.sm, padding: theme.spacing(2), borderWidth: 1, borderColor: theme.colors.accent },
  configLabel: { color: theme.colors.accent, fontSize: 10, fontWeight: "700", letterSpacing: 0.3, marginBottom: theme.spacing(1), fontFamily: theme.font.mono },
  configText: { color: theme.colors.textDim, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 16 },
  serverBtnRow: { flexDirection: "row", gap: theme.spacing(2.5), marginTop: theme.spacing(2) },
  serverBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(1.5), borderRadius: theme.radius.sm, paddingVertical: theme.spacing(1.8), paddingHorizontal: theme.spacing(3), flex: 1 },
  serverBtnAi: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.accent },
  serverBtnAiText: { color: theme.colors.accent, fontSize: 13, fontWeight: "700", fontFamily: theme.font.mono },
  serverBtnLaunch: { backgroundColor: theme.colors.accent },
  serverBtnLaunchText: { color: theme.colors.bg, fontSize: 13, fontWeight: "700", fontFamily: theme.font.mono },
  // Server instance cards
  serverRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  serverInfo: { flex: 1 },
  serverNameRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusRunning: { backgroundColor: theme.colors.ok },
  statusLaunching: { backgroundColor: theme.colors.warn },
  statusStopped: { backgroundColor: theme.colors.textFaint },
  serverName: { color: theme.colors.text, fontSize: 14, fontWeight: "700", fontFamily: theme.font.mono, flexShrink: 1 },
  serverMeta: { color: theme.colors.textDim, fontSize: 10, fontFamily: theme.font.mono, marginTop: 2 },
  serverUptime: { color: theme.colors.ok, fontSize: 9, fontFamily: theme.font.mono, marginTop: 2 },
  serverActions: { flexDirection: "row", gap: theme.spacing(2), alignItems: "center" },
  serverIconBtn: { width: 32, height: 32, borderRadius: theme.radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface },
  serverIconBtnStop: { backgroundColor: "rgba(255,90,90,0.12)" },
  logPanel: { marginTop: theme.spacing(2.5), backgroundColor: "rgba(0,0,0,0.5)", borderRadius: theme.radius.sm, padding: theme.spacing(2), maxHeight: 200 },
  logText: { color: theme.colors.textDim, fontSize: 9, fontFamily: theme.font.mono, lineHeight: 14 },
});
