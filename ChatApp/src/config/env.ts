export type AppEnv = {
  nexoraLearningBaseUrl: string;
  chatDBServerBaseUrl: string;
  chatDBServerPublicApiKey: string;
  nexoraLearningRuntimeApiKey: string;
};

const DEFAULT_BASE_URL = "https://chat.himpqblog.cn:5002";
const DEFAULT_CHAT_BASE_URL = "https://chat.himpqblog.cn";

export const appEnv: AppEnv = {
  nexoraLearningBaseUrl:
    process.env.EXPO_PUBLIC_NEXORA_LEARNING_BASE_URL || DEFAULT_BASE_URL,
  chatDBServerBaseUrl:
    process.env.EXPO_PUBLIC_CHAT_DB_SERVER_BASE_URL || DEFAULT_CHAT_BASE_URL,
  chatDBServerPublicApiKey:
    process.env.EXPO_PUBLIC_CHAT_DB_SERVER_PUBLIC_API_KEY || "",
  nexoraLearningRuntimeApiKey:
    process.env.EXPO_PUBLIC_NEXORA_LEARNING_RUNTIME_API_KEY || "",
};
