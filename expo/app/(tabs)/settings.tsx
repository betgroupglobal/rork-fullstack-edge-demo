import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import {
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
  Trash2,
  Wrench,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
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
import PressableScale from "@/components/PressableScale";
import { theme } from "@/constants/theme";
import {
  useDeleteWorkerConfig,
  useUpdateWorkerConfig,
  useWorkerConfig,
} from "@/hooks/useGateway";
import { setBaseUrl } from "@/lib/api";

// ── Constants ──

const SETTINGS_KEY = "edge-gateway-settings-v2";
type AppSettings = { gatewayUrl: string; proxyHost: string; allowedOrigins: string; apiKey: string };
function defaultSettings(): AppSettings { return { gatewayUrl: "", proxyHost: "", allowedOrigins: "", apiKey: "" }; }

const BOOLEAN_FIELDS = new Set(["INTERCEPT_LAB_MODE"]);
const SECRET_FIELDS = new Set(["API_KEY", "CF_API_KEY", "CF_API_TOKEN"]);

const CONFIG_GROUPS: Array<{ title: string; icon: React.ElementType; keys: string[] }> = [
  { title: "Security", icon: Shield, keys: ["API_KEY"] },
  { title: "Edge Proxy", icon: Globe, keys: ["PROXY_TARGET", "BASE_DOMAIN", "ALLOWED_ORIGINS"] },
  { title: "Intercept Lab", icon: Sliders, keys: ["INTERCEPT_LAB_MODE", "INTERCEPT_ALLOWLIST", "INTERCEPT_BLOCKLIST", "INTERCEPT_TTL_SECONDS"] },
  { title: "Cloudflare", icon: Key, keys: ["CF_API_TOKEN", "CF_API_KEY", "CF_API_EMAIL"] },
  { title: "Residential Proxy", icon: Globe, keys: ["RESIDENTIAL_PROXY_POOL"] },
];

const FIELD_LABELS: Record<string, string> = {
  ALLOWED_ORIGINS: "Allowed Origins", INTERCEPT_LAB_MODE: "Intercept Lab Mode",
  INTERCEPT_ALLOWLIST: "Intercept Allowlist", INTERCEPT_BLOCKLIST: "Intercept Blocklist",
  INTERCEPT_TTL_SECONDS: "Intercept TTL", API_KEY: "API Key",
  CF_API_KEY: "Cloudflare API Key", CF_API_EMAIL: "Cloudflare API Email",
  CF_API_TOKEN: "Cloudflare API Token", PROXY_TARGET: "Default Proxy Target", BASE_DOMAIN: "Base Domain",
};

const FIELD_HINTS: Record<string, string> = {
  ALLOWED_ORIGINS: "Comma-separated origins allowed for CORS. Use * to allow all.",
  INTERCEPT_LAB_MODE: "Enable payload capture on proxied requests.",
  INTERCEPT_TTL_SECONDS: "How long to retain captures (seconds). Default: 600.",
  API_KEY: "Bearer token for write operations and config changes.",
  CF_API_TOKEN: "Scoped Cloudflare API Token (recommended).",
};

const FIELD_DEFAULT: Record<string, string> = {
  ALLOWED_ORIGINS: "", INTERCEPT_LAB_MODE: "false", INTERCEPT_ALLOWLIST: "",
  INTERCEPT_BLOCKLIST: "", INTERCEPT_TTL_SECONDS: "600", API_KEY: "",
  CF_API_KEY: "", CF_API_EMAIL: "", CF_API_TOKEN: "", PROXY_TARGET: "", BASE_DOMAIN: "",
};

function authHeader(apiKey: string): string | undefined {
  return apiKey.trim() ? `Bearer ${apiKey.trim()}` : undefined;
}

// ── Architecture info (absorbed from About) ──

const ARCHITECTURE = [
  { icon: Server, title: "Expo App", body: "Dashboard for managing proxies, viewing intercepted traffic, running reconnaissance, and configuring the gateway." },
  { icon: ShieldCheck, title: "Edge Gateway", body: "Cloudflare Worker — wildcard DNS routing, WebSocket passthrough, HTML rewriting, and security headers on every request." },
  { icon: Database, title: "Durable Object", body: "SQLite-backed persistence for proxies, items, config overrides, intercept captures, and phishlets." },
];

const CAPABILITIES = [
  { icon: Globe, title: "Wildcard proxy routing", body: "Catch-all subdomain routing with automatic Cloudflare DNS records." },
  { icon: ScanEye, title: "Intercept capture", body: "Full request/response capture with credential extraction and sensitive value masking." },
  { icon: Puzzle, title: "Per-proxy JS injection", body: "Inject custom JavaScript into proxied HTML pages for data collection." },
  { icon: Radio, title: "WebSocket passthrough", body: "Full-duplex WebSocket upgrade preserved transparently." },
  { icon: Cpu, title: "Automated phishlet generation", body: "One-tap recon pipeline: capture → generate → iterate → refine." },
  { icon: Lock, title: "API key auth", body: "Bearer token authentication on all write endpoints and config changes." },
  { icon: Layers, title: "Runtime config", body: "Live config overrides persisted in the DO — no redeploy needed." },
  { icon: ArrowRight, title: "HAR replay engine", body: "Export captures as HAR and replay full sessions against any target." },
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

  // Worker config
  const ah = authHeader(settings.apiKey);
  const config = useWorkerConfig(ah);
  const updateConfig = useUpdateWorkerConfig(ah);
  const clearConfig = useDeleteWorkerConfig(ah);
  const [edit, setEdit] = useState<Record<string, string>>({ ...FIELD_DEFAULT });
  const [editDirty, setEditDirty] = useState(false);

  useEffect(() => { if (!editDirty) setEdit({ ...FIELD_DEFAULT, ...(config.data ?? {}) }); }, [config.data, editDirty]);

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
        <Text style={styles.intro}>Manage API keys, app settings, runtime worker configuration, and architecture reference — all from one place.</Text>

        {settings.gatewayUrl.trim() === "" && (
          <View style={styles.setupBanner}>
            <Text style={styles.setupTitle}>Gateway URL required</Text>
            <Text style={styles.setupText}>Enter your worker URL below to connect this app to your gateway.</Text>
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
          <AppField label="Gateway URL" value={settings.gatewayUrl} onChange={(v) => updateApp("gatewayUrl", v)} placeholder="https://your-worker.example.workers.dev" />
          <AppField label="Proxy Host" value={settings.proxyHost} onChange={(v) => updateApp("proxyHost", v)} placeholder="https://example.com" />
          <AppField label="Allowed Origins" value={settings.allowedOrigins} onChange={(v) => updateApp("allowedOrigins", v)} placeholder="*" />
          {dirty && (
            <PressableScale onPress={saveApp} haptic="medium" style={styles.saveBtn}>
              <Save size={15} color={theme.colors.bg} />
              <Text style={styles.saveBtnText}>Save app settings</Text>
            </PressableScale>
          )}
        </View>

        {/* ── Worker Runtime Config ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Sliders size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Worker Runtime Config</Text>
          </View>
          <Text style={styles.sectionDesc}>Overrides stored in the Durable Object. Take precedence over wrangler env vars.</Text>

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
                  <Text style={styles.saveBtnText}>{updateConfig.isPending ? "Saving..." : "Save worker config"}</Text>
                </PressableScale>
              )}
            </>
          )}
        </View>

        {/* ── Worker URLs ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Wrench size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Worker URLs &amp; APIs</Text>
          </View>
          <View style={styles.urlCard}>
            <CopyRow label="Gateway URL" value={settings.gatewayUrl || "Not configured"} />
            <CopyRow label="Health" value={`${settings.gatewayUrl}/health`} />
            <CopyRow label="Config API" value={`${settings.gatewayUrl}/api/config`} />
            <CopyRow label="Proxies API" value={`${settings.gatewayUrl}/api/proxies`} />
            <CopyRow label="Intercepts API" value={`${settings.gatewayUrl}/api/intercepts`} />
            <CopyRow label="HAR Export" value={`${settings.gatewayUrl}/api/intercepts/har`} />
          </View>
        </View>

        {/* ── Architecture (from About) ── */}
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
        <PressableScale onPress={() => Linking.openURL("https://developers.cloudflare.com/workers/")} haptic="light" style={styles.docBtn}>
          <Text style={styles.docBtnText}>Cloudflare Workers docs</Text>
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
  saveBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
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
  docBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  docBtnText: { color: theme.colors.bg, fontWeight: "800", fontSize: 14 },
  footer: { color: theme.colors.textFaint, fontSize: 11, textAlign: "center", marginTop: theme.spacing(4), fontFamily: theme.font.mono },
});
