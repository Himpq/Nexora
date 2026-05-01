import { AppCard, AppText, Screen } from "../../../design";

export function DashboardScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">学习看板</AppText>
      <AppCard>
        <AppText tone="secondary">
          Dashboard 切片将在接入 `/api/frontend/dashboard` 后展示已加入课程、教材数量和学习时长。
        </AppText>
      </AppCard>
    </Screen>
  );
}
