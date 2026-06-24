import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Key,
  RefreshCw,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Shield,
  Sliders,
  Trash2,
  Wrench,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

import { theme } from "@/constants/theme";
import {
  useDeleteWorkerConfig,
  useUpdateWorkerConfig,
  useWorkerConfig,
} from "@/hooks/useGateway";
import { setBaseUrl } from "@/lib/api";

/** Persisted app-level settings key in AsyncStorage. */
const SETTINGS_KEY = "edge-gateway-settings-v2";

type AppSettings = {
  gatewayUrl: string;
  proxyHost: string;
  allowedOrigins: string;
  apiKey: string;
};

function defaultSettings(): AppSettings {
  return {
    gatewayUrl: "",
    proxyHost: "",
    allowedOrigins: "",
    apiKey: "",
  };
}

/** Boolean-config fields shown as toggles. */
const BOOLEAN_FIELDS = new Set(["INTERCEPT_LAB_MODE"]);

/** Fields that should be masked by default (secrets / keys). */
const SECRET_FIELDS = new Set(["API_KEY", "CF_API_KEY", "CF_API_TOKEN"]);

/** Logical groupings for the worker runtime config editor. */
const CONFIG_GROUPS: Array<{ title: string; icon: React.ElementType; keys: string[] }> = [
  { title: "Security", icon: Shield, keys: ["API_KEY"] },
  { title: "Edge Proxy", icon: Globe, keys: ["PROXY_TARGET", "BASE_DOMAIN", "ALLOWED_ORIGINS"] },
  { title: "Intercept Lab", icon: Sliders, keys: ["INTERCEPT_LAB_MODE", "INTERCEPT_ALLOWLIST", "INTERCEPT_BLOCKLIST", "INTERCEPT_TTL_SECONDS"] },
  { title: "Cloudflare", icon: Key, keys: ["CF_API_TOKEN", "CF_API_KEY", "CF_API_EMAIL"] },
];

/** Labels for config fields shown in the editor. */
const FIELD_LABELS: Record<string, string> = {
  ALLOWED_ORIGINS: "Allowed Origins",
  INTERCEPT_LAB_MODE: "Intercept Lab Mode",
  INTERCEPT_ALLOWLIST: "Intercept Allowlist",
  INTERCEPT_BLOCKLIST: "Intercept Blocklist",
  INTERCEPT_TTL_SECONDS: "Intercept TTL (seconds)",
  API_KEY: "API Key",
  CF_API_KEY: "Cloudflare API Key",
  CF_API_EMAIL: "Cloudflare API Email",
  CF_API_TOKEN: "Cloudflare API Token",
  PROXY_TARGET: "Default Proxy Target",
  BASE_DOMAIN: "Base Domain",
};

/** Hint text shown below each Worker Runtime Config field. */
const FIELD_HINTS: Record<string, string> = {
  ALLOWED_ORIGINS:
    "Comma-separated origins allowed for CORS (e.g. https://app.example.com). Use * to allow all.",
  INTERCEPT_LAB_MODE:
    "Enable payload capture on proxied requests. Must also enable Intercept on individual proxy targets.",
  INTERCEPT_ALLOWLIST:
    "Only capture traffic to these upstream hostnames (comma-separated). Leave empty to capture all.",
  INTERCEPT_BLOCKLIST:
    "Never capture traffic to these upstream hostnames (comma-separated). Takes precedence over allowlist.",
  INTERCEPT_TTL_SECONDS:
    "How long (seconds) to retain captures before they are purged. Default: 600 (10 min).",
  API_KEY:
    "Bearer token required for write operations, intercept access, and config changes. Leave empty to disable auth.",
  CF_API_KEY:
    "Cloudflare Global API Key. Used together with CF_API_EMAIL. Not required if CF_API_TOKEN is set.",
  CF_API_EMAIL:
    "Cloudflare account email that owns the Global API Key.",
  CF_API_TOKEN:
    "Scoped Cloudflare API Token (recommended). If set, it takes precedence over the Global API Key.",
  PROXY_TARGET:
    "Default upstream URL for /proxy traffic when no proxy slug is provided (e.g. https://example.com).",
  BASE_DOMAIN:
    "Root domain used for auto-allocated subdomains (e.g. example.com).",
};

/** Default values pre-filled into every Worker Runtime Config field. */
const FIELD_DEFAULT: Record<string, string> = {
  ALLOWED_ORIGINS: "",
  INTERCEPT_LAB_MODE: "false",
  INTERCEPT_ALLOWLIST: "",
  INTERCEPT_BLOCKLIST: "",
  INTERCEPT_TTL_SECONDS: "600",
  API_KEY: "",
  CF_API_KEY: "",
  CF_API_EMAIL: "",
  CF_API_TOKEN: "",
  PROXY_TARGET: "",
  BASE_DOMAIN: "",
};

function authHeader(apiKey: string): string | undefined {
  return apiKey.trim() ? `Bearer ${apiKey.trim()}` : undefined;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  // --- App-level settings (AsyncStorage) ---
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  useEffect(() => {
    (async () => {
      let apiKey = "";
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        const stored = raw !== null ? (JSON.parse(raw) as Partial<AppSettings>) : {};
        apiKey = (await AsyncStorage.getItem("edge-api-key")) || "";
        const gatewayUrl = stored.gatewayUrl || "";
        setBaseUrl(gatewayUrl);
        setSettings({
          gatewayUrl,
          proxyHost: stored.proxyHost || "",
          allowedOrigins: stored.allowedOrigins || "",
          apiKey,
        });
      } catch {
        setSettings(defaultSettings());
      }
      setSettingsLoaded(true);
    })();
  }, []);

  const persistSettings = useCallback(async (next: AppSettings) => {
    await AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        gatewayUrl: next.gatewayUrl,
        proxyHost: next.proxyHost,
        allowedOrigins: next.allowedOrigins,
      }),
    );
    await AsyncStorage.setItem("edge-api-key", next.apiKey);
  }, []);

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setSettingsDirty(true);
    },
    [],
  );

  const saveAppSettings = useCallback(() => {
    setBaseUrl(settings.gatewayUrl);
    persistSettings(settings);
    setSettingsDirty(false);
  }, [settings, persistSettings]);

  // --- API key visibility ---
  const [showKey, setShowKey] = useState(false);

  // --- Worker config ---
  const ah = authHeader(settings.apiKey);
  const config = useWorkerConfig(ah);
  const updateConfig = useUpdateWorkerConfig(ah);
  const clearConfig = useDeleteWorkerConfig(ah);

  // Local edit buffer for worker config fields — pre-seeded with defaults.
  const [edit, setEdit] = useState<Record<string, string>>({ ...FIELD_DEFAULT });
  const [editDirty, setEditDirty] = useState(false);

  useEffect(() => {
    if (!editDirty) {
      setEdit({ ...FIELD_DEFAULT, ...(config.data ?? {}) });
    }
  }, [config.data, editDirty]);

  const updateField = useCallback((key: string, value: string) => {
    setEdit((prev) => ({ ...prev, [key]: value }));
    setEditDirty(true);
  }, []);

  const toggleBool = useCallback(
    (key: string, current: string) => {
      const next = current === "true" ? "false" : "true";
      setEdit((prev) => ({ ...prev, [key]: next }));
      setEditDirty(true);
    },
    [],
  );

  const saveConfig = useCallback(() => {
    updateConfig.mutate(edit, {
      onSuccess: () => setEditDirty(false),
    });
  }, [edit, updateConfig]);

  const revertConfig = useCallback(() => {
    Alert.alert("Revert to defaults", "Clear all runtime config overrides?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revert",
        style: "destructive",
        onPress: () => {
          clearConfig.mutate(undefined, {
            onSuccess: () => {
              setEdit({ ...FIELD_DEFAULT });
              setEditDirty(false);
            },
          });
        },
      },
    ]);
  }, [clearConfig]);

  if (!settingsLoaded) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color={theme.colors.accent} style={{ flex: 1 }} />
      </View>
    );
  }

  const isSaving = updateConfig.isPending;
  const isClearing = clearConfig.isPending;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[theme.colors.accentGlow, "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.4 }}
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
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <Text style={styles.title}>Configuration</Text>
        <Text style={styles.intro}>
          Manage API keys, app settings, and runtime worker configuration from
          one place.
        </Text>

        {settings.gatewayUrl.trim() === "" && (
          <View style={styles.setupBanner}>
            <Text style={styles.setupTitle}>Gateway URL required</Text>
            <Text style={styles.setupText}>
              Enter your worker URL below to connect this app to your gateway.
              Everything else can be configured from the UI once connected.
            </Text>
          </View>
        )}

        {/* ---- API Key ---- */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Key size={16} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>API Key</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Used to authenticate write operations, intercept access, and config
            changes on the gateway.
          </Text>
          <View style={styles.keyRow}>
            <TextInput
              style={styles.keyInput}
              value={settings.apiKey}
              onChangeText={(v) => updateSetting("apiKey", v)}
              placeholder="API key"
              placeholderTextColor={theme.colors.textFaint}
              secureTextEntry={!showKey}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
            />
            <Pressable
              onPress={() => setShowKey((p) => !p)}
              style={styles.iconBtn}
              hitSlop={8}
            >
              {showKey ? (
                <EyeOff size={18} color={theme.colors.textDim} />
              ) : (
                <Eye size={18} color={theme.colors.textDim} />
              )}
            </Pressable>
          </View>
        </View>

        {/* ---- App Settings ---- */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SettingsIcon size={16} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>App Settings</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Persisted on this device. Used as build-time overrides.
          </Text>

          <AppField
            label="Gateway URL"
            value={settings.gatewayUrl}
            onChange={(v) => updateSetting("gatewayUrl", v)}
            placeholder="https://your-worker.your-account.workers.dev"
          />
          <AppField
            label="Proxy Host"
            value={settings.proxyHost}
            onChange={(v) => updateSetting("proxyHost", v)}
            placeholder="https://example.com"
          />
          <AppField
            label="Allowed Origins"
            value={settings.allowedOrigins}
            onChange={(v) => updateSetting("allowedOrigins", v)}
            placeholder="*"
          /> // placeholder kept as example; value is empty by default

          {settingsDirty && (
            <Pressable
              onPress={saveAppSettings}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && styles.saveBtnPressed,
              ]}
            >
              <Save size={16} color={theme.colors.bg} />
              <Text style={styles.saveBtnText}>Save app settings</Text>
            </Pressable>
          )}
        </View>

        {/* ---- Worker Runtime Config ---- */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Sliders size={16} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Worker Runtime Config</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Overrides stored in the Durable Object. Takes precedence over
            wrangler env vars. Secret keys are masked by default.
          </Text>

          {config.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text style={styles.loadingText}>Loading config...</Text>
            </View>
          ) : config.isError ? (
            <View style={styles.configCard}>
              <Shield size={20} color={theme.colors.danger} />
              <Text style={styles.errorText}>
                {config.error?.message ?? "Failed to load config. Check your API key."}
              </Text>
            </View>
          ) : (
            <>
              {CONFIG_GROUPS.map((group) => (
                <View key={group.title} style={styles.configGroup}>
                  <View style={styles.configGroupHeader}>
                    <group.icon size={14} color={theme.colors.accent} />
                    <Text style={styles.configGroupTitle}>{group.title}</Text>
                  </View>
                  {group.keys.map((key) => (
                    <ConfigField
                      key={key}
                      fieldKey={key}
                      value={edit[key] ?? FIELD_DEFAULT[key] ?? ""}
                      onChange={updateField}
                    />
                  ))}
                </View>
              ))}

              {config.data && Object.keys(config.data).length > 0 && (
                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>
                    {Object.keys(config.data).length} runtime override
                    {Object.keys(config.data).length !== 1 ? "s" : ""} active
                  </Text>
                  <Pressable
                    onPress={revertConfig}
                    style={({ pressed }) => [
                      styles.dangerBtn,
                      pressed && styles.dangerBtnPressed,
                    ]}
                    disabled={isClearing}
                  >
                    {isClearing ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.danger}
                      />
                    ) : (
                      <Trash2 size={14} color={theme.colors.danger} />
                    )}
                    <Text style={styles.dangerBtnText}>Revert to defaults</Text>
                  </Pressable>
                </View>
              )}

              {editDirty && (
                <Pressable
                  onPress={saveConfig}
                  style={({ pressed }) => [
                    styles.saveBtn,
                    pressed && styles.saveBtnPressed,
                  ]}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.bg}
                    />
                  ) : (
                    <Save size={16} color={theme.colors.bg} />
                  )}
                  <Text style={styles.saveBtnText}>
                    {isSaving ? "Saving..." : "Save worker config"}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        {/* ---- Worker URLs & APIs ---- */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Wrench size={16} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Worker URLs & APIs</Text>
          </View>
          <View style={styles.infoCard}>
            <InfoRow
              icon={Copy}
              label="Gateway URL"
              value={settings.gatewayUrl || "Not configured"}
            />
            <InfoRow
              icon={Copy}
              label="Health"
              value={`${settings.gatewayUrl}/health`}
            />
            <InfoRow
              icon={Copy}
              label="Config API"
              value={`${settings.gatewayUrl}/api/config`}
            />
            <InfoRow
              icon={Copy}
              label="Proxies API"
              value={`${settings.gatewayUrl}/api/proxies`}
            />
            <InfoRow
              icon={Copy}
              label="Intercepts API"
              value={`${settings.gatewayUrl}/api/intercepts`}
            />
            <InfoRow
              icon={Copy}
              label="Worker Routes API"
              value={`${settings.gatewayUrl}/api/cloudflare/worker-routes`}
            />
            <InfoRow
              icon={Copy}
              label="Beacon API"
              value={`${settings.gatewayUrl}/api/beacon`}
            />
            <InfoRow
              icon={Copy}
              label="Docs"
              value="developers.cloudflare.com/workers/"
            />
          </View>
        </View>

        <Text style={styles.footer}>Settings stored locally in AsyncStorage</Text>
      </ScrollView>
    </View>
  );
}

// ---- Mini-components ----

function AppField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.appField}>
      <Text style={styles.appFieldLabel}>{label}</Text>
      <TextInput
        style={styles.appFieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function ConfigField({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
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
            trackColor={{
              false: theme.colors.surfaceAlt,
              true: theme.colors.accentDim,
            }}
            thumbColor={current === "true" ? theme.colors.accent : theme.colors.textFaint}
          />
        ) : (
          <View style={styles.configValueRow}>
            <TextInput
              style={[
                styles.configInput,
                isSecret && { width: 180, textAlign: "left" },
              ]}
              value={current}
              onChangeText={(v) => onChange(fieldKey, v)}
              placeholder={FIELD_DEFAULT[fieldKey] ?? ""}
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={isSecret && !show}
              textContentType={isSecret ? "password" : "none"}
            />
            {isSecret ? (
              <Pressable
                onPress={() => setShow((p) => !p)}
                style={styles.clearBtn}
                hitSlop={8}
              >
                {show ? (
                  <EyeOff size={14} color={theme.colors.textFaint} />
                ) : (
                  <Eye size={14} color={theme.colors.textFaint} />
                )}
              </Pressable>
            ) : isModified ? (
              <Pressable
                onPress={() => onChange(fieldKey, FIELD_DEFAULT[fieldKey] ?? "")}
                style={styles.clearBtn}
                hitSlop={8}
              >
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

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Copy;
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    Clipboard.setString(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [value]);

  return (
    <Pressable onPress={copy} style={({ pressed }) => [styles.infoRow, pressed && styles.pressed]}>
      <Icon size={14} color={theme.colors.textDim} />
      <View style={styles.infoBody}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
      {copied ? (
        <Check size={14} color={theme.colors.ok} />
      ) : (
        <Copy size={14} color={theme.colors.textFaint} />
      )}
    </Pressable>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 260 },
  content: {
    paddingHorizontal: theme.spacing(5),
    paddingBottom: theme.spacing(12),
    gap: theme.spacing(3),
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    fontFamily: theme.font.mono,
  },
  title: {
    color: theme.colors.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  intro: {
    color: theme.colors.textDim,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: theme.spacing(1),
  },
  setupBanner: {
    backgroundColor: "rgba(255,178,62,0.10)",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,178,62,0.35)",
    padding: theme.spacing(4),
    gap: theme.spacing(1),
  },
  setupTitle: {
    color: theme.colors.warn,
    fontSize: 14,
    fontWeight: "800",
  },
  setupText: {
    color: theme.colors.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
  section: {
    marginTop: theme.spacing(1),
    gap: theme.spacing(2),
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  sectionDesc: {
    color: theme.colors.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  keyInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
    paddingVertical: theme.spacing(3),
    paddingLeft: theme.spacing(4),
    fontFamily: theme.font.mono,
    letterSpacing: 1,
  },
  iconBtn: {
    padding: theme.spacing(3),
  },
  appField: {
    gap: 2,
  },
  appFieldLabel: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  appFieldInput: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: Platform.select({ ios: 10, default: 8 }),
    paddingHorizontal: theme.spacing(3),
    color: theme.colors.text,
    fontSize: 14,
    fontFamily: theme.font.mono,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.accent,
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
    marginTop: theme.spacing(1),
  },
  saveBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  saveBtnText: {
    color: theme.colors.bg,
    fontWeight: "800",
    fontSize: 14,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    padding: theme.spacing(3),
  },
  loadingText: {
    color: theme.colors.textDim,
    fontSize: 13,
  },
  configCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  configGroup: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    marginBottom: theme.spacing(2),
  },
  configGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    backgroundColor: theme.colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  configGroupTitle: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  configRow: {
    flexDirection: "column",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  configLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
  },
  configLabel: { flex: 1, gap: 2, marginRight: theme.spacing(3) },
  configHint: {
    color: theme.colors.textFaint,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: theme.font.mono,
    marginTop: theme.spacing(1.5),
  },
  configKey: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  configVar: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontFamily: theme.font.mono,
  },
  configValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  configInput: {
    width: 140,
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: Platform.select({ ios: 8, default: 6 }),
    paddingHorizontal: theme.spacing(2),
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.font.mono,
    textAlign: "right",
  },
  clearBtn: {
    padding: 4,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.bgElevated,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaText: {
    color: theme.colors.textFaint,
    fontSize: 12,
    fontFamily: theme.font.mono,
  },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dangerBtnPressed: { opacity: 0.7 },
  dangerBtnText: { color: theme.colors.danger, fontSize: 13, fontWeight: "600" },
  errorText: {
    color: theme.colors.textDim,
    fontSize: 13,
    marginLeft: theme.spacing(3),
    flexShrink: 1,
  },
  infoCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    gap: theme.spacing(3),
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  pressed: { opacity: 0.6 },
  infoBody: { flex: 1, gap: 2 },
  infoLabel: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: "600",
  },
  infoValue: {
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.font.mono,
  },
  footer: {
    color: theme.colors.textFaint,
    fontSize: 12,
    textAlign: "center",
    marginTop: theme.spacing(4),
    fontFamily: theme.font.mono,
  },
});
