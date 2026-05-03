import { AppCard, AppText, Screen } from "../../../design";

export function VectorizeScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">向量化</AppText>
      <AppCard>
        <AppText tone="secondary">提炼和向量化是两个阶段，不要用一个 processed 布尔值概括。</AppText>
      </AppCard>
    </Screen>
  );
}
