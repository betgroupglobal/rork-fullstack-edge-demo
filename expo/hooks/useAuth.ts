import createContextHook from "@nkzw/create-context-hook";
import { useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { useCallback, useEffect, useState } from "react";

import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  type AuthUser,
} from "@/lib/api";

const TOKEN_KEY = "edge-auth-token";

/** SecureStore is unavailable on web; fall back to localStorage there. */
async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function writeToken(token: string | null): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
      else globalThis.localStorage?.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapped, setBootstrapped] = useState<boolean>(false);

  // Restore a persisted session on launch and validate it against the gateway.
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async (): Promise<AuthUser | null> => {
      const stored = await readToken();
      if (!stored) return null;
      try {
        const me = await fetchMe(stored);
        setToken(stored);
        return me;
      } catch {
        await writeToken(null);
        return null;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (sessionQuery.isSuccess) {
      setUser(sessionQuery.data);
      setBootstrapped(true);
    } else if (sessionQuery.isError) {
      setBootstrapped(true);
    }
  }, [sessionQuery.isSuccess, sessionQuery.isError, sessionQuery.data]);

  const signIn = useCallback(async (email: string, password: string): Promise<void> => {
    const session = await apiLogin({ email: email.trim(), password });
    await writeToken(session.token);
    setToken(session.token);
    setUser(session.user);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string): Promise<void> => {
      const session = await apiSignup({ email: email.trim(), password, name: name.trim() });
      await writeToken(session.token);
      setToken(session.token);
      setUser(session.user);
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    const current = token;
    setToken(null);
    setUser(null);
    await writeToken(null);
    if (current) await apiLogout(current);
  }, [token]);

  return {
    token,
    user,
    isAuthenticated: !!user,
    isLoading: !bootstrapped,
    signIn,
    signUp,
    signOut,
  };
});
