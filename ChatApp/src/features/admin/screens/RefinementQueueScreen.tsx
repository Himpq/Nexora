import { AppCard, AppText, Screen } from "../../../design";

export function RefinementQueueScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">提炼队列</AppText>
      <AppCard>
        <AppText tone="secondary">后续通过 `refinementService.getRefinementQueue()` 轮询队列。</AppText>
      </AppCard>
    </Screen>
  );
}
