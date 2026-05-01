import { AppCard, AppText, Screen } from "../../../design";

export function BookDetailScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">教材详情</AppText>
      <AppCard>
        <AppText tone="secondary">后续切片展示教材元数据、原文、概读和精读入口。</AppText>
      </AppCard>
    </Screen>
  );
}
