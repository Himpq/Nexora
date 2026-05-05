import { AppCard, AppText, Screen } from "../../../design";

export function ConversationScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">AI 问答</AppText>
      <AppCard>
        <AppText tone="secondary">
          AI Chat MVP 应优先接非流式 `nexoraModelService.chatCompletions()`，并带上当前课程/教材上下文。
        </AppText>
      </AppCard>
    </Screen>
  );
}
