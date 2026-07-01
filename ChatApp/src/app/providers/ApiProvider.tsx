import React, { createContext, useContext, useMemo } from "react";

import { appEnv } from "../../config/env";
import { chatApiClient, learningApiClient } from "../../services/apiClient";

type ApiProviderValue = {
  learningBaseUrl: string;
  chatBaseUrl: string;
  learningClient: typeof learningApiClient;
  chatClient: typeof chatApiClient;
};

const ApiContext = createContext<ApiProviderValue | null>(null);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<ApiProviderValue>(
    () => ({
      learningBaseUrl: appEnv.nexoraLearningBaseUrl,
      chatBaseUrl: appEnv.chatDBServerBaseUrl,
      learningClient: learningApiClient,
      chatClient: chatApiClient,
    }),
    [],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApiConfig() {
  const value = useContext(ApiContext);
  if (!value) {
    throw new Error("useApiConfig must be used inside ApiProvider");
  }
  return value;
}
