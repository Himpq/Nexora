export type AppEnv = {
  nexoraLearningBaseUrl: string;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:5001";

export const appEnv: AppEnv = {
  nexoraLearningBaseUrl:
    process.env.EXPO_PUBLIC_NEXORA_LEARNING_BASE_URL || DEFAULT_BASE_URL,
};
