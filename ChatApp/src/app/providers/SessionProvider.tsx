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

export type LoginRole = "user" | "admin";

export class SessionRoleMismatchError extends Error {
  expectedRole: LoginRole;
  actualRole: LoginRole;

  constructor(expectedRole: LoginRole, actualRole: LoginRole) {
    super(
      expectedRole === "admin"
        ? "该账号不是管理员，请使用用户登录"
        : "请使用管理员登录",
    );
    this.name = "SessionRoleMismatchError";
    this.expectedRole = expectedRole;
    this.actualRole = actualRole;
  }
}

type SessionState = {
  username: string;
  context: FrontendContext | null;
  isBootstrapping: boolean;
  isContextLoading: boolean;
  contextError: Error | null;
  isAdmin: boolean;
  /** Logs into the chat backend (sets the session cookie) and loads context. */
  signIn: (
    username: string,
    password: string,
    options?: { expectedRole?: LoginRole },
  ) => Promise<void>;
  setUsername: (username: string) => Promise<void>;
  refreshContext: () => Promise<void>;
  clearUsername: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

function resolveIsAdmin(context: FrontendContext | null) {
  const role = String(context?.user?.role || "").trim().toLowerCase();
  return Boolean(context?.is_admin) || role === "admin";
}

function resolveLoginRole(context: FrontendContext | null): LoginRole {
  return resolveIsAdmin(context) ? "admin" : "user";
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
    async (
      nextUsername: string,
      password: string,
      options: { expectedRole?: LoginRole } = {},
    ) => {
      const normalized = String(nextUsername || "").trim();
      const requestId = contextRequestIdRef.current + 1;
      let didAuthenticate = false;
      contextRequestIdRef.current = requestId;
      setIsContextLoading(true);
      setContextError(null);

      // Throws ApiClientError on bad credentials; let the caller surface it.
      try {
        await sessionLogin(normalized, password);
        didAuthenticate = true;
        setApiUsername(normalized);

        const nextContext = await getFrontendContext(normalized);
        const actualRole = resolveLoginRole(nextContext);
        const expectedRole = options.expectedRole;

        if (expectedRole && actualRole !== expectedRole) {
          await sessionLogout();
          await AsyncStorage.removeItem(USERNAME_STORAGE_KEY);
          if (contextRequestIdRef.current === requestId) {
            setUsernameState("");
            setApiUsername("");
            setContext(null);
            setContextError(null);
            setIsContextLoading(false);
            setNexoraPortalBaseUrl("");
          }
          throw new SessionRoleMismatchError(expectedRole, actualRole);
        }

        await AsyncStorage.setItem(USERNAME_STORAGE_KEY, normalized);
        if (contextRequestIdRef.current === requestId) {
          setUsernameState(normalized);
          setContext(nextContext);
          setNexoraPortalBaseUrl(nextContext?.integration?.base_url);
          setIsContextLoading(false);
        }
      } catch (err) {
        if (!(err instanceof SessionRoleMismatchError)) {
          if (didAuthenticate) {
            await sessionLogout();
          }
          await AsyncStorage.removeItem(USERNAME_STORAGE_KEY);
          if (contextRequestIdRef.current === requestId) {
            setUsernameState("");
            setApiUsername("");
            setContext(null);
            setContextError(normalizeError(err));
            setIsContextLoading(false);
            setNexoraPortalBaseUrl("");
          }
        }
        throw err;
      }
    },
    [],
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
