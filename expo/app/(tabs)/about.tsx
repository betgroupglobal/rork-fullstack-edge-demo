import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  Database,
  FileText,
  Gauge,
  Globe,
  Lock,
  Server,
  ShieldCheck,
  Timer,
} from "lucide-react-native";
import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/constants/theme";

const PIPELINE = [
  {
    icon: Globe,
    title: "CORS",
    body: "Origins validated; preflight handled at the edge before anything reaches storage.",
    color: theme.colors.cyan,
  },
  {
    icon: Timer,
    title: "Rate limiting",
    body: "A sliding per-IP window guards the API. Live budget is shown on the Status tab.",
    color: theme.colors.warn,
  },
  {
    icon: Gauge,
    title: "Edge caching",
    body: "GET reads are cached at the edge for 10s — responses tag X-Cache HIT or MISS.",
    color: theme.colors.accent,
  },
  {
    icon: Lock,
    title: "Security headers",
    body: "nosniff, X-Frame-Options, Referrer-Policy and Permissions-Policy on every response.",
    color: theme.colors.ok,
  },
  {
    icon: FileText,
    title: "Request logging",
    body: "Each invocation is captured in a per-project ring buffer for debugging.",
    color: theme.colors.danger,
  },
] as const;

const STACK = [
  {
    icon: Server,
    title: "Frontend",
    body: "This Expo app — React Query for data, animated status and CRUD screens.",
  },
  {
    icon: ShieldCheck,
    title: "Edge gateway",
    body: "A Cloudflare Worker handling CORS, rate limits, caching and security.",
  },
  {
    icon: Database,
    title: "Storage",
    body: "A Durable Object with SQLite — your items persist between visits.",
  },
] as const;

const NEXT_STEPS = [
  "Add authentication and per-user items",
  "Introduce validation and structured errors",
  "Wire a custom domain to the gateway",
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
        <Text style={styles.title}>How it works</Text>
        <Text style={styles.intro}>
          Three layers work together: the app you&apos;re using, an edge gateway
          that shapes every request, and durable cloud storage behind it.
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

        <Text style={styles.sectionTitle}>Request lifecycle</Text>
        <Text style={styles.sectionSub}>
          What the gateway does to every call before it hits storage.
        </Text>
        <View style={styles.pipeline}>
          {PIPELINE.map((step) => {
            const Icon = step.icon;
            return (
              <View key={step.title} style={styles.pipeCard}>
                <View style={[styles.pipeIcon, { borderColor: step.color }]}>
                  <Icon size={18} color={step.color} />
                </View>
                <View style={styles.pipeBody}>
                  <Text style={styles.pipeTitle}>{step.title}</Text>
                  <Text style={styles.pipeText}>{step.body}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Next steps</Text>
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
  pipeline: { gap: theme.spacing(3) },
  pipeCard: {
    flexDirection: "row",
    gap: theme.spacing(3),
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
  },
  pipeIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  pipeBody: { flex: 1, gap: 3 },
  pipeTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  pipeText: { color: theme.colors.textDim, fontSize: 13, lineHeight: 19 },
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
