import { AppCard, AppText, Screen } from "../../../design";

export function BookReaderScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">教材阅读</AppText>
      <AppCard>
        <AppText tone="secondary">
          第一版可把 `bookinfo` / `bookdetail` 的 XML 内容作为可读文本展示。
        </AppText>
      </AppCard>
    </Screen>
  );
}
