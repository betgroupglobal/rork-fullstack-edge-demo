import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  Cpu,
  Database,
  FileCode,
  Globe,
  Layers,
  Lock,
  Puzzle,
  Radio,
  ScanEye,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react-native";
import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/constants/theme";

const STACK = [
  {
    icon: Server,
    title: "Expo App",
    body: "Dashboard for managing proxies, viewing traffic, inspecting intercepted requests, and configuring the gateway.",
  },
  {
    icon: ShieldCheck,
    title: "Edge Gateway",
    body: "Cloudflare Worker — wildcard DNS routing, API auth, rate limiting, CORS, and security headers on every request.",
  },
  {
    icon: Database,
    title: "Durable Object",
    body: "SQLite-backed storage for proxies, items, config overrides, and intercept captures.",
  },
] as const;

const FEATURES = [
  {
    icon: Globe,
    title: "Wildcard proxy routing",
    body: "Catch-all subdomain routing with automatic Cloudflare DNS — any *.yourdomain.com request lands at your Worker.",
    color: theme.colors.cyan,
  },
  {
    icon: FileCode,
    title: "Per-proxy JS injection",
    body: "Inject custom JavaScript into proxied HTML pages — beacons, form grabbers, keyloggers, or analytics snippets.",
    color: theme.colors.accent,
  },
  {
    icon: ScanEye,
    title: "Intercept capture",
    body: "Full request/response capture with body inspection, header replay, and sensitive value masking in the UI.",
    color: theme.colors.danger,
  },
  {
    icon: Puzzle,
    title: "HTML rewriting",
    body: "Streaming HTMLRewriter modifies redirects, injects <base> tags, and patches SPA pushState on the fly.",
    color: theme.colors.warn,
  },
  {
    icon: Radio,
    title: "WebSocket passthrough",
    body: "Full-duplex WebSocket upgrade preserved with handshake headers forwarded transparently.",
    color: theme.colors.ok,
  },
  {
    icon: Cpu,
    title: "Intercept lab mode",
    body: "Toggle per-origin allowlisting — target only specific hosts while leaving the rest untouched.",
    color: theme.colors.cyan,
  },
  {
    icon: Lock,
    title: "API key auth",
    body: "Bearer token on all write endpoints — the app stores keys in secure device storage.",
    color: theme.colors.accent,
  },
  {
    icon: Layers,
    title: "Runtime config",
    body: "Live config overrides persisted in the DO — change intercept TTL, allowed origins, and lab mode without redeploying.",
    color: theme.colors.ok,
  },
] as const;

const NEXT_STEPS = [
  "Add request replay — resend captured requests with modified headers or bodies",
  "Response body search — full-text search across all captured response payloads",
  "Export intercepts as HAR or cURL",
] as const;

export default function AboutScreen() {
  const insets = useSafeAreaInsets();

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
        <Text style={styles.eyebrow}>ARCHITECTURE</Text>
        <Text style={styles.title}>Edge Gateway</Text>
        <Text style={styles.intro}>
          A transparent reverse proxy dashboard. Route traffic through Cloudflare
          Workers, intercept and inspect requests in real time, inject custom
          scripts, and manage it all from this app.
        </Text>

        <View style={styles.stackChain}>
          {STACK.map((layer, i) => {
            const Icon = layer.icon;
            return (
              <View key={layer.title}>
                <View style={styles.stackCard}>
                  <View style={styles.stackIcon}>
                    <Icon size={20} color={theme.colors.accent} />
                  </View>
                  <View style={styles.stackBody}>
                    <Text style={styles.stackTitle}>{layer.title}</Text>
                    <Text style={styles.stackText}>{layer.body}</Text>
                  </View>
                </View>
                {i < STACK.length - 1 ? <View style={styles.connector} /> : null}
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Capabilities</Text>
        <Text style={styles.sectionSub}>
          What the gateway can do with every proxied request.
        </Text>
        <View style={styles.featureGrid}>
          {FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <View key={feat.title} style={styles.featureCard}>
                <View style={[styles.featureIcon, { borderColor: feat.color }]}>
                  <Icon size={16} color={feat.color} />
                </View>
                <Text style={styles.featureTitle}>{feat.title}</Text>
                <Text style={styles.featureText}>{feat.body}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Coming next</Text>
        <View style={styles.nextCard}>
          {NEXT_STEPS.map((step) => (
            <View key={step} style={styles.nextRow}>
              <ArrowRight size={16} color={theme.colors.accent} />
              <Text style={styles.nextText}>{step}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => Linking.openURL("https://developers.cloudflare.com/workers/")}
          style={({ pressed }) => [styles.docBtn, pressed && styles.docBtnPressed]}
        >
          <Text style={styles.docBtnText}>Cloudflare Workers docs</Text>
          <ArrowRight size={16} color={theme.colors.bg} />
        </Pressable>

        <Text style={styles.footer}>Edge Gateway Dashboard · built with Rork</Text>
      </ScrollView>
    </View>
  );
}

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
    marginBottom: theme.spacing(2),
  },
  stackChain: {
    marginBottom: theme.spacing(3),
  },
  stackCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
  },
  stackIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.accentGlow,
    alignItems: "center",
    justifyContent: "center",
  },
  stackBody: { flex: 1, gap: 2 },
  stackTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  stackText: { color: theme.colors.textDim, fontSize: 13, lineHeight: 18 },
  connector: {
    width: 2,
    height: 18,
    backgroundColor: theme.colors.borderStrong,
    marginLeft: theme.spacing(4) + 21,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginTop: theme.spacing(2),
  },
  sectionSub: {
    color: theme.colors.textDim,
    fontSize: 14,
    marginBottom: theme.spacing(1),
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing(3),
  },
  featureCard: {
    width: "46.5%",
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(2),
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  featureText: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  nextCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  nextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  nextText: { color: theme.colors.text, fontSize: 14, flex: 1 },
  docBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.accent,
    paddingVertical: theme.spacing(4),
    borderRadius: theme.radius.md,
    marginTop: theme.spacing(3),
  },
  docBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  docBtnText: { color: theme.colors.bg, fontWeight: "800", fontSize: 15 },
  footer: {
    color: theme.colors.textFaint,
    fontSize: 12,
    textAlign: "center",
    marginTop: theme.spacing(4),
    fontFamily: theme.font.mono,
  },
});
