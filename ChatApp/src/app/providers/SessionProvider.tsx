import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { setApiUsername } from "../../services/apiClient";
import { getFrontendContext } from "../../services/frontendService";
import { setNexoraPortalBaseUrl } from "../../services/imageService";
import { login as sessionLogin, logout as sessionLogout } from "../../services/sessionService";
import type { FrontendContext } from "../../services/types";
import { normalizeError } from "../../utils/errors";

const USERNAME_STORAGE_KEY = "nexora.chatapp.username";

type SessionState = {
  username: string;
  context: FrontendContext | null;
  isBootstrapping: boolean;
  isContextLoading: boolean;
  contextError: Error | null;
  isAdmin: boolean;
  /** Logs into the chat backend (sets the session cookie) and loads context. */
  signIn: (username: string, password: string) => Promise<void>;
  setUsername: (username: string) => Promise<void>;
  refreshContext: () => Promise<void>;
  clearUsername: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

function resolveIsAdmin(context: FrontendContext | null) {
  const role = String(context?.user?.role || "").trim().toLowerCase();
  return Boolean(context?.is_admin) || role === "admin";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsernameState] = useState("");
  const [context, setContext] = useState<FrontendContext | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [contextError, setContextError] = useState<Error | null>(null);
  const contextRequestIdRef = useRef(0);

  const loadContext = useCallback(async (nextUsername: string) => {
    const normalized = String(nextUsername || "").trim();
    const requestId = contextRequestIdRef.current + 1;
    contextRequestIdRef.current = requestId;

    if (!normalized) {
      setContext(null);
      setContextError(null);
      setIsContextLoading(false);
      setNexoraPortalBaseUrl("");
      return;
    }

    setIsContextLoading(true);
    setContextError(null);
    try {
      const nextContext = await getFrontendContext(normalized);
      if (contextRequestIdRef.current === requestId) {
        setContext(nextContext);
        setNexoraPortalBaseUrl(nextContext?.integration?.base_url);
      }
    } catch (err) {
      if (contextRequestIdRef.current === requestId) {
        setContext(null);
        setContextError(normalizeError(err));
      }
    } finally {
      if (contextRequestIdRef.current === requestId) {
        setIsContextLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrapSession() {
      try {
        const storedUsername = await AsyncStorage.getItem(USERNAME_STORAGE_KEY);
        if (!mounted) {
          return;
        }

        const normalized = String(storedUsername || "").trim();
        if (normalized) {
          setUsernameState(normalized);
          setApiUsername(normalized);
          await loadContext(normalized);
        } else {
          setApiUsername("");
        }
      } catch (err) {
        if (mounted) {
          setContextError(normalizeError(err));
        }
      } finally {
        if (mounted) {
          setIsBootstrapping(false);
        }
      }
    }

    bootstrapSession();

    return () => {
      mounted = false;
    };
  }, [loadContext]);

  const setUsername = useCallback(async (nextUsername: string) => {
    const normalized = String(nextUsername || "").trim();
    await AsyncStorage.setItem(USERNAME_STORAGE_KEY, normalized);
    setUsernameState(normalized);
    setApiUsername(normalized);
    await loadContext(normalized);
  }, [loadContext]);

  const signIn = useCallback(
    async (nextUsername: string, password: string) => {
      const normalized = String(nextUsername || "").trim();
      // Throws ApiClientError on bad credentials; let the caller surface it.
      await sessionLogin(normalized, password);
      await AsyncStorage.setItem(USERNAME_STORAGE_KEY, normalized);
      setUsernameState(normalized);
      setApiUsername(normalized);
      await loadContext(normalized);
    },
    [loadContext],
  );

  const refreshContext = useCallback(async () => {
    await loadContext(username);
  }, [loadContext, username]);

  const clearUsername = useCallback(async () => {
    await sessionLogout();
    await AsyncStorage.removeItem(USERNAME_STORAGE_KEY);
    contextRequestIdRef.current += 1;
    setUsernameState("");
    setApiUsername("");
    setContext(null);
    setContextError(null);
    setIsContextLoading(false);
    setNexoraPortalBaseUrl("");
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      username,
      context,
      isBootstrapping,
      isContextLoading,
      contextError,
      isAdmin: resolveIsAdmin(context),
      signIn,
      setUsername,
      refreshContext,
      clearUsername,
    }),
    [
      username,
      context,
      isBootstrapping,
      isContextLoading,
      contextError,
      signIn,
      setUsername,
      refreshContext,
      clearUsername,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return value;
}
