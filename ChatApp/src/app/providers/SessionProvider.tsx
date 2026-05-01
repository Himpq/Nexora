import React, { createContext, useContext, useMemo, useState } from "react";

import { setApiUsername } from "../../services/apiClient";

type SessionState = {
  username: string;
  context: null;
  isBootstrapping: false;
  isAdmin: false;
  setUsername: (username: string) => Promise<void>;
  refreshContext: () => Promise<void>;
  clearUsername: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsernameState] = useState("");

  async function setUsername(nextUsername: string) {
    const normalized = String(nextUsername || "").trim();
    setUsernameState(normalized);
    setApiUsername(normalized);
  }

  async function clearUsername() {
    setUsernameState("");
    setApiUsername("");
  }

  const value = useMemo<SessionState>(
    () => ({
      username,
      context: null,
      isBootstrapping: false,
      isAdmin: false,
      setUsername,
      refreshContext: async () => undefined,
      clearUsername,
    }),
    [username],
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
