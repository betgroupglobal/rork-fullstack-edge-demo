import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Lock, Mail, ShieldCheck, User } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PressableScale from "@/components/PressableScale";
import { theme } from "@/constants/theme";
import { useAuth } from "@/hooks/useAuth";

type Mode = "signin" | "signup";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const isSignup = mode === "signup";

  const submit = useCallback(async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (isSignup && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      if (isSignup) {
        await signUp(email, password, name);
      } else {
        await signIn(email, password);
      }
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }, [email, password, name, isSignup, signIn, signUp, router]);

  const toggleMode = useCallback(() => {
    setError(null);
    setMode((m) => (m === "signin" ? "signup" : "signin"));
  }, []);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[theme.colors.accentGlow, "transparent"]}
        style={styles.glow}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + theme.spacing(14), paddingBottom: insets.bottom + theme.spacing(8) },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.badge}>
            <ShieldCheck color={theme.colors.accent} size={30} strokeWidth={2.2} />
          </View>
          <Text style={styles.brand}>EDGE GATEWAY</Text>
          <Text style={styles.title}>{isSignup ? "Create your account" : "Welcome back"}</Text>
          <Text style={styles.subtitle}>
            {isSignup
              ? "Set up secure access to your gateway control plane."
              : "Sign in to access your gateway control plane."}
          </Text>

          <View style={styles.form}>
            {isSignup ? (
              <Field
                icon={<User color={theme.colors.textFaint} size={18} />}
                placeholder="Name (optional)"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            ) : null}
            <Field
              icon={<Mail color={theme.colors.textFaint} size={18} />}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            <Field
              icon={<Lock color={theme.colors.textFaint} size={18} />}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <PressableScale
              haptic="medium"
              onPress={submit}
              disabled={busy}
              style={styles.cta}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.bg} />
              ) : (
                <Text style={styles.ctaText}>{isSignup ? "Create account" : "Sign in"}</Text>
              )}
            </PressableScale>
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>
              {isSignup ? "Already have an account?" : "Need an account?"}
            </Text>
            <PressableScale haptic="selection" onPress={toggleMode} style={styles.switchBtn}>
              <Text style={styles.switchAction}>{isSignup ? "Sign in" : "Create one"}</Text>
            </PressableScale>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & { icon: React.ReactNode };

function Field({ icon, ...props }: FieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldIcon}>{icon}</View>
      <TextInput
        style={styles.input}
        placeholderTextColor={theme.colors.textFaint}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 340 },
  content: { paddingHorizontal: theme.spacing(6), alignItems: "stretch" },
  badge: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    marginBottom: theme.spacing(5),
  },
  brand: {
    color: theme.colors.accent,
    fontFamily: theme.font.mono,
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: "700",
    marginBottom: theme.spacing(2),
  },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: {
    color: theme.colors.textDim,
    fontSize: 15,
    lineHeight: 21,
    marginTop: theme.spacing(2),
  },
  form: { marginTop: theme.spacing(8), gap: theme.spacing(3) },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(4),
  },
  fieldIcon: { marginRight: theme.spacing(3) },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 16,
    paddingVertical: Platform.select({ ios: 16, default: 12 }),
  },
  error: {
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: "600",
    marginTop: theme.spacing(1),
  },
  cta: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing(4),
    alignItems: "center",
    justifyContent: "center",
    marginTop: theme.spacing(2),
    minHeight: 54,
  },
  ctaText: {
    color: theme.colors.bg,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: theme.spacing(7),
    gap: theme.spacing(2),
  },
  switchLabel: { color: theme.colors.textDim, fontSize: 14 },
  switchBtn: { paddingVertical: theme.spacing(1) },
  switchAction: { color: theme.colors.accent, fontSize: 14, fontWeight: "700" },
});
