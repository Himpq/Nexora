import { AppCard, AppText, Screen } from "../../../design";

export function CourseDetailScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">课程详情</AppText>
      <AppCard>
        <AppText tone="secondary">后续切片接入 Lecture 详情和教材列表。</AppText>
      </AppCard>
    </Screen>
  );
}
