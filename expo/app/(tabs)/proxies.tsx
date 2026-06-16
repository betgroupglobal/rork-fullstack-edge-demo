import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  Check,
  Copy,
  Globe,
  Link2,
  Loader,
  Power,
  Trash2,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
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
import {
  useAllocateProxyDomain,
  useCloudflareZones,
  useCreateProxy,
  useDeleteProxy,
  useProxies,
  useUpdateProxy,
} from "@/hooks/useGateway";
import { proxyUrl, type Proxy } from "@/lib/api";

function DomainPanel({ proxy }: { proxy: Proxy }) {
  const { data, isLoading, isError } = useCloudflareZones();
  const allocate = useAllocateProxyDomain();
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

function ProxyCard({ proxy }: { proxy: Proxy }) {
  const updateProxy = useUpdateProxy();
  const deleteProxy = useDeleteProxy();
  const [copied, setCopied] = useState<boolean>(false);
  const [domainCopied, setDomainCopied] = useState<boolean>(false);
  const [showDomains, setShowDomains] = useState<boolean>(false);

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
        <View style={styles.hits}>
          <Zap size={12} color={theme.colors.accent} />
          <Text style={styles.hitsText}>{proxy.hits}</Text>
        </View>
      </View>

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

      {proxy.proxyDomain ? (
        <Pressable
          onPress={copyDomain}
          style={({ pressed }) => [styles.domainRow, pressed && styles.pressed]}
        >
          <Globe size={14} color={theme.colors.ok} />
          <Text style={styles.domainUrl} numberOfLines={1}>
            {proxy.proxyDomain}
          </Text>
          {domainCopied ? (
            <Check size={15} color={theme.colors.ok} />
          ) : (
            <Copy size={15} color={theme.colors.textDim} />
          )}
        </Pressable>
      ) : null}

      <Pressable
        onPress={() => setShowDomains((v) => !v)}
        style={({ pressed }) => [styles.allocateBtn, pressed && styles.pressed]}
      >
        <Link2 size={14} color={theme.colors.accent} />
        <Text style={styles.allocateText}>
          {proxy.proxyDomain ? "Change domain" : "Allocate domain"}
        </Text>
      </Pressable>

      {showDomains ? <DomainPanel proxy={proxy} /> : null}

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
  const { data, isLoading, isError, error } = useProxies();
  const createProxy = useCreateProxy();

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
                <ProxyCard key={proxy.id} proxy={proxy} />
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
});
