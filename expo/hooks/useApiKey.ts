import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

/** Returns the stored API key as a Bearer auth header, or undefined if not set. */
export function useApiKey(): string | undefined {
  const [authHeader, setAuthHeader] = useState<string | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem("edge-api-key").then((key) => {
      setAuthHeader(key?.trim() ? `Bearer ${key.trim()}` : undefined);
    });
  }, []);

  return authHeader;
}
