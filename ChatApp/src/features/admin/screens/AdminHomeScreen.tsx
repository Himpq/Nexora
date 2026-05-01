import { AppCard, AppText, Screen } from "../../../design";

export function AdminHomeScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">内容管理</AppText>
      <AppCard>
        <AppText tone="secondary">
          管理端切片应在学习者主路径稳定后实现，包括教材上传、提炼队列和向量化状态。
        </AppText>
      </AppCard>
    </Screen>
  );
}
