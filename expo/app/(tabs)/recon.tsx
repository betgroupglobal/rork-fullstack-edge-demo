import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, ExternalLink, Fingerprint, Globe, Loader, Radar, RefreshCw, Server, Shield, Wand2 } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "@/components/WebView";

import MiniMetric from "@/components/MiniMetric";
import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import PulseDot from "@/components/PulseDot";
import EmptyState from "@/components/EmptyState";
import { layout, card, type as typeStyles, form, list } from "@/constants/styles";
import { theme } from "@/constants/theme";
import { useApiKey } from "@/hooks/useApiKey";
import { useGenerateLoginPhishlet, useGeneratePhishlet, useIteratePhishlet, useProxies } from "@/hooks/useGateway";
import { getBaseUrl, proxyUrl } from "@/lib/api";
import type { CritiqueEntry } from "@/lib/api/types";
import { CAPTURE_SCRIPT } from "@/lib/scripts/capture";
import { LOGIN_PROBE_SCRIPT } from "@/lib/scripts/login-probe";
import { mergeCaptureMessage, mapCapturedData } from "@/lib/scripts/mapCapturedData";

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
    return `GATEWAY_BASE_URL=${getBaseUrl()} \\
GATEWAY_API_KEY=$GATEWAY_API_KEY \\
PROXY_ID=${selected.id} \\
npx tsx agents/phishlet-constructor.ts \\
  --target-url "${loginUrl.trim()}" \\
  --authorized`;
  }, [selected, loginUrl]);

  useEffect(() => {
    if (proxies.length === 1 && !selectedSlug) {
      setSelectedSlug(proxies[0].slug);
    }
  }, [proxies, selectedSlug]);

  const runScan = useCallback(() => {
    if (!selected) return;
    setCaptured({});
    setGenerated("");
    setRefinedYaml("");
    setIterateResult(null);
    setLoginMode(false);
    setLoginYaml("");
    setStage("scanning");
    setActiveUrl(proxyUrl(selected.slug));
    setWebviewKey((k) => k + 1);
  }, [selected]);

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

  const onMessage = useCallback((event: { nativeEvent: { data?: string | Record<string, unknown> } }) => {
    try {
      const raw = event.nativeEvent.data;
      if (raw == null) return;
      const data: Record<string, unknown> =
        typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw;
      setCaptured((prev) => mergeCaptureMessage(prev, data));
    } catch { /* ignore */ }
  }, []);

  const hasCaptureData = useMemo(() => {
    const fields = (captured.formFields as unknown[]) ?? [];
    return fields.length > 0 || captured.pageTitle != null;
  }, [captured]);

  useEffect(() => {
    if (stage === "scanning" && hasCaptureData && !generate.isPending && !generated) {
      setStage("generating");
      const cap = mapCapturedData(captured);
      generate.mutate(
        { proxyId: selected!.id, input: { targetUrl: selected!.targetUrl, captured: cap } },
        { onSuccess: (data) => setGenerated(data.phishlet) },
      );
    }
  }, [stage, hasCaptureData, captured, generate, generated, selected]);

  useEffect(() => {
    if (stage === "generating" && generated && !iterate.isPending && !refinedYaml) {
      setStage("iterating");
      const cap = mapCapturedData(captured);
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
    idle: "", scanning: "Scanning target — browse the login page…",
    generating: "Generating phishlet YAML…", iterating: "Self-critique & refining…", done: "Scan complete",
  };
  const stageIcon: Record<Stage, React.ElementType | null> = {
    idle: null, scanning: Radar, generating: Wand2, iterating: RefreshCw, done: Check,
  };
  const stageColor: Record<Stage, string> = {
    idle: theme.colors.textFaint, scanning: theme.colors.cyan, generating: theme.colors.accent,
    iterating: theme.colors.warn, done: theme.colors.ok,
  };

  return (
    <View style={layout.root}>
      <LinearGradient colors={[theme.colors.accentGlow, "transparent"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 0.5 }} style={layout.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={[layout.content, { paddingTop: insets.top + theme.spacing(6) }]} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={typeStyles.eyebrow}>RECONNAISSANCE</Text>
          <Text style={typeStyles.hero}>Phishlet generator</Text>
          <Text style={typeStyles.sub}>
            One tap to scan a target, capture its login flow, and auto-generate a refined YAML phishlet with multi-pass validation.
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : isError ? (
          <OfflineCard message="Could not load proxy targets." onRetry={() => refetch()} />
        ) : proxies.length === 0 ? (
          <EmptyState
            icon={<Radar size={26} color={theme.colors.accent} />}
            title="No proxy targets"
            subtitle="Create a proxy target first to run reconnaissance."
          />
        ) : (
          <>
            <View style={card.surface}>
              <View style={styles.controlTop}>
                <Text style={form.label}>TARGET</Text>
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
                  haptic="heavy" onPress={runScan} disabled={stage !== "idle" && stage !== "done"}
                  style={[form.submitBtn, stage !== "idle" && stage !== "done" && { opacity: 0.7 }]}
                >
                  {stage === "idle" || stage === "done" ? (
                    <><Radar size={16} color={theme.colors.bg} /><Text style={form.submitText}>{stage === "done" ? "Rescan" : "Run scan"}</Text></>
                  ) : (
                    <><Loader size={16} color={theme.colors.bg} /><Text style={form.submitText}>{stageLabel[stage]}</Text></>
                  )}
                </PressableScale>
              )}
            </View>

            {/* Login Phishlet Automator */}
            {selected && (
              <View style={[card.surface, { gap: theme.spacing(3) }]}>
                <Text style={form.label}>LOGIN PHISHLET AUTOMATOR</Text>
                <View style={styles.loginRow}>
                  <TextInput
                    value={loginUrl} onChangeText={setLoginUrl}
                    placeholder="https://target.com/login" placeholderTextColor={theme.colors.textFaint}
                    autoCapitalize="none" autoCorrect={false} keyboardType="url"
                    style={[form.input, { flex: 1 }]}
                  />
                  <PressableScale
                    haptic="medium" onPress={runLoginScan}
                    disabled={!loginUrl.trim() || generateLogin.isPending}
                    style={[form.submitBtn, { paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5), marginTop: 0 }, (!loginUrl.trim() || generateLogin.isPending) && { opacity: 0.5 }]}
                  >
                    {generateLogin.isPending ? <Loader size={14} color={theme.colors.bg} /> : <><Fingerprint size={14} color={theme.colors.bg} /><Text style={form.submitText}>Generate</Text></>}
                  </PressableScale>
                </View>
                {loginYaml ? (
                  <View style={styles.loginYamlCard}>
                    <View style={styles.loginYamlHeader}>
                      <Text style={styles.loginYamlTitle}>Generated YAML</Text>
                      <Pressable onPress={() => copy(loginYaml, "loginYaml")} style={styles.copyBtn}>
                        {copiedField === "loginYaml" ? <Check size={14} color={theme.colors.ok} /> : <Copy size={14} color={theme.colors.cyan} />}
                      </Pressable>
                    </View>
                    <Text style={styles.loginYamlApplied}>Applied to proxy: {selected?.name || selected?.slug}</Text>
                    <Text style={styles.loginYaml} numberOfLines={12} ellipsizeMode="tail">{loginYaml}</Text>
                  </View>
                ) : loginMode && !captured.loginForm ? (
                  <View style={styles.loginStatus}>
                    <Loader size={14} color={theme.colors.accent} />
                    <Text style={styles.loginStatusText}>Navigating and probing login form…</Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Headless Agent */}
            {selected && (
              <View style={[card.surface, { gap: theme.spacing(3) }]}>
                <Text style={form.label}>HEADLESS AGENT</Text>
                <Text style={typeStyles.sub}>Run the Puppeteer agent locally and have it upload the result back to this proxy.</Text>
                <PressableScale haptic="medium" onPress={() => setShowAgentCommand((s) => !s)} disabled={!agentCommand} style={[styles.agentToggle, !agentCommand && { opacity: 0.5 }]}>
                  <Server size={14} color={theme.colors.bg} />
                  <Text style={styles.agentToggleText}>{showAgentCommand ? "Hide command" : "Show command"}</Text>
                </PressableScale>
                {showAgentCommand && agentCommand ? (
                  <View style={styles.agentCommandCard}>
                    <View style={styles.loginYamlHeader}>
                      <Text style={styles.loginYamlTitle}>Terminal command</Text>
                      <Pressable onPress={() => copy(agentCommand, "agentCommand")} style={styles.copyBtn}>
                        {copiedField === "agentCommand" ? <Check size={14} color={theme.colors.ok} /> : <Copy size={14} color={theme.colors.cyan} />}
                      </Pressable>
                    </View>
                    <Text style={styles.agentCommand}>{agentCommand}</Text>
                    <Text style={styles.agentNote}>Set GATEWAY_API_KEY in your terminal first, then paste and run.</Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Pipeline progress */}
            {stage !== "idle" && (
              <View style={[styles.progressBar, { borderColor: stageColor[stage] }]}>
                <View style={styles.progressSteps}>
                  {(["scanning", "generating", "iterating", "done"] as Stage[]).map((s) => {
                    const passed = (s === "scanning" && (stage === "generating" || stage === "iterating" || stage === "done")) ||
                      (s === "generating" && (stage === "iterating" || stage === "done")) || (s === "iterating" && stage === "done");
                    const current = stage === s;
                    return (
                      <View key={s} style={styles.progressStep}>
                        <View style={[styles.progressDot, current && { backgroundColor: stageColor[s], borderColor: stageColor[s] }, passed && { backgroundColor: theme.colors.ok, borderColor: theme.colors.ok }]}>
                          {passed ? <Check size={8} color={theme.colors.bg} /> : current ? <Loader size={8} color={theme.colors.bg} /> : null}
                        </View>
                        <Text style={[styles.progressLabel, (current || passed) && { color: passed ? theme.colors.ok : stageColor[s] }]}>
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
                    javaScriptEnabled thirdPartyCookiesEnabled domStorageEnabled
                  />
                </View>
              </View>
            )}

            {/* Captured intelligence */}
            {stage !== "idle" && (
              <View style={card.surface}>
                <View style={styles.intelHeader}>
                  <Fingerprint size={14} color={stage === "scanning" ? theme.colors.cyan : theme.colors.accent} />
                  <Text style={[typeStyles.sectionTitle, { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "700" }]}>Captured intelligence</Text>
                  {stage === "scanning" && <PulseDot active size={8} color={theme.colors.cyan} />}
                </View>
                {captured.pageTitle ? (
                  <View style={styles.intelRow}><Globe size={11} color={theme.colors.textFaint} /><Text style={styles.intelVal} numberOfLines={1}>{captured.pageTitle as string}</Text></View>
                ) : null}
                {captured.formAction ? (
                  <View style={styles.intelRow}><Server size={11} color={theme.colors.textFaint} /><Text style={styles.intelVal} numberOfLines={1}>{(captured.formMethod as string)?.toUpperCase() ?? "POST"} {(captured.formAction as string)}</Text></View>
                ) : null}
                <View style={styles.metricsRow}>
                  <MiniMetric label="URLs" value={(captured.urls as string[])?.length ?? 0} />
                  <MiniMetric label="Fields" value={(captured.formFields as unknown[])?.length ?? 0} />
                  <MiniMetric label="Cookies" value={(captured.cookies as string[])?.length ?? 0} />
                  <MiniMetric label="Domains" value={(captured.domains as string[])?.length ?? 0} />
                </View>
                <View style={styles.metricsRow}>
                  <MiniMetric label="Hidden" value={(captured.hiddenInputs as unknown[])?.length ?? 0} />
                  <MiniMetric label="CSRF" value={(captured.csrfFields as unknown[])?.length ?? 0} />
                  <MiniMetric label="Auth URLs" value={(captured.authLinks as unknown[])?.length ?? 0} />
                  <MiniMetric label="APIs" value={(captured.apiEndpoints as string[])?.length ?? 0} />
                </View>
                {(captured.authLinks as { href: string; text: string }[])?.length > 0 && (
                  <View style={styles.detailList}>
                    <Text style={styles.detailListTitle}>Auth links</Text>
                    {(captured.authLinks as { href: string; text: string }[]).slice(0, 5).map((l, i) => (
                      <View key={i} style={styles.detailRow}><ExternalLink size={10} color={theme.colors.textFaint} /><Text style={styles.detailText} numberOfLines={1}>{l.text || l.href}</Text></View>
                    ))}
                  </View>
                )}
                {(captured.apiEndpoints as string[])?.length > 0 && (
                  <View style={styles.detailList}>
                    <Text style={styles.detailListTitle}>API endpoints</Text>
                    {(captured.apiEndpoints as string[]).slice(0, 5).map((e, i) => (
                      <View key={i} style={styles.detailRow}><Server size={10} color={theme.colors.textFaint} /><Text style={styles.detailText} numberOfLines={1}>{e}</Text></View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Generated YAML */}
            {generated ? (
              <View style={card.surface}>
                <View style={styles.resultHeader}><Wand2 size={14} color={theme.colors.warn} /><Text style={styles.resultTitle}>Generated phishlet</Text></View>
                <ScrollView horizontal style={styles.codeScroll} showsHorizontalScrollIndicator={false}><Text style={styles.code}>{generated}</Text></ScrollView>
                <Pressable onPress={() => copy(generated, "gen")} style={styles.copyRow}>
                  {copiedField === "gen" ? <Check size={12} color={theme.colors.ok} /> : <Copy size={12} color={theme.colors.accent} />}
                  <Text style={styles.copyText}>{copiedField === "gen" ? "Copied" : "Copy YAML"}</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Iteration report */}
            {iterateResult ? (
              <View style={card.surface}>
                <View style={styles.resultHeader}>
                  <Shield size={14} color={theme.colors.ok} />
                  <Text style={[styles.resultTitle, { flex: 1 }]}>Refined phishlet</Text>
                  <View style={[styles.scoreBadge, iterateResult.score >= 80 ? styles.scoreGood : styles.scoreWarn]}>
                    <Text style={styles.scoreText}>{iterateResult.score}/100</Text>
                  </View>
                </View>
                <Text style={styles.iterateMeta}>{iterateResult.passes} pass{iterateResult.passes !== 1 ? "es" : ""} · {iterateResult.critiques.length} finding{iterateResult.critiques.length !== 1 ? "s" : ""} · {iterateResult.improvements.length} improvement{iterateResult.improvements.length !== 1 ? "s" : ""}</Text>
                {iterateResult.critiques.length > 0 && (
                  <View style={styles.critiqueList}>
                    {iterateResult.critiques.map((c, i) => (
                      <View key={i} style={styles.critiqueRow}>
                        <View style={[styles.severityDot, c.severity === "critical" ? styles.sevCritical : c.severity === "warning" ? styles.sevWarning : styles.sevInfo]} />
                        <View style={styles.critiqueBody}><Text style={styles.critiqueFinding}>{c.finding}</Text><Text style={styles.critiqueFix}>{c.fix}</Text></View>
                      </View>
                    ))}
                  </View>
                )}
                {refinedYaml ? (
                  <>
                    <ScrollView horizontal style={styles.codeScroll} showsHorizontalScrollIndicator={false}><Text style={styles.code}>{refinedYaml}</Text></ScrollView>
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

const styles = StyleSheet.create({
  controlTop: { gap: theme.spacing(2) },
  proxyChips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
  chip: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  chipActive: { backgroundColor: "rgba(255,178,62,0.10)", borderColor: theme.colors.warn },
  chipText: { color: theme.colors.textDim, fontSize: 12, fontWeight: "600", fontFamily: theme.font.mono },
  chipTextActive: { color: theme.colors.warn },
  loginRow: { flexDirection: "row", gap: theme.spacing(2) },
  loginYamlCard: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), gap: theme.spacing(2) },
  loginYamlHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  loginYamlTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
  copyBtn: { padding: theme.spacing(1) },
  loginYaml: { color: theme.colors.textDim, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 16 },
  loginYamlApplied: { color: theme.colors.ok, fontSize: 10, fontFamily: theme.font.mono, marginTop: -theme.spacing(1) },
  loginStatus: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), paddingVertical: theme.spacing(2) },
  loginStatusText: { color: theme.colors.textDim, fontSize: 12, fontFamily: theme.font.mono },
  agentToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(1.5), backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: theme.spacing(2.5) },
  agentToggleText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
  agentCommandCard: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), gap: theme.spacing(2) },
  agentCommand: { color: theme.colors.cyan, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 16 },
  agentNote: { color: theme.colors.textFaint, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 15 },
  progressBar: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, paddingVertical: theme.spacing(3), paddingHorizontal: theme.spacing(4) },
  progressSteps: { flexDirection: "row", justifyContent: "space-between" },
  progressStep: { alignItems: "center", gap: theme.spacing(1.5) },
  progressDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.colors.border, backgroundColor: theme.colors.bgElevated, alignItems: "center", justifyContent: "center" },
  progressLabel: { color: theme.colors.textFaint, fontSize: 9, fontWeight: "700", fontFamily: theme.font.mono, letterSpacing: 0.5 },
  browserPanel: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  browserHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5), borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: theme.spacing(2) },
  browserUrlWrap: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), flex: 1 },
  browserUrl: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, flex: 1 },
  closeBrowser: { paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(1) },
  closeBrowserText: { color: theme.colors.textFaint, fontSize: 11, fontWeight: "600" },
  webviewWrap: { height: 340, backgroundColor: theme.colors.bg, margin: theme.spacing(2), borderRadius: theme.radius.sm, overflow: "hidden" },
  webview: { flex: 1 },
  intelHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  intelRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  intelVal: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, flex: 1 },
  metricsRow: { flexDirection: "row", gap: theme.spacing(2) },
  detailList: { gap: theme.spacing(1.5) },
  detailListTitle: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, fontFamily: theme.font.mono },
  detailRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  detailText: { color: theme.colors.textDim, fontSize: 10, fontFamily: theme.font.mono, flex: 1 },
  resultHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  resultTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  codeScroll: { maxHeight: 200 },
  code: { color: theme.colors.text, fontSize: 10, fontFamily: theme.font.mono, lineHeight: 16 },
  copyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), alignSelf: "flex-start", backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  copyText: { color: theme.colors.accent, fontSize: 11, fontWeight: "700" },
  scoreBadge: { borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(2), paddingVertical: 2 },
  scoreGood: { backgroundColor: "rgba(60,224,138,0.12)", borderWidth: 1, borderColor: "rgba(60,224,138,0.35)" },
  scoreWarn: { backgroundColor: "rgba(255,178,62,0.12)", borderWidth: 1, borderColor: "rgba(255,178,62,0.35)" },
  scoreText: { color: theme.colors.text, fontSize: 11, fontWeight: "800", fontFamily: theme.font.mono },
  iterateMeta: { color: theme.colors.textFaint, fontSize: 11, fontFamily: theme.font.mono },
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
