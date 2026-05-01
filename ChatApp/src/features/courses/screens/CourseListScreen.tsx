import { AppCard, AppText, Screen } from "../../../design";

export function CourseListScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">课程库</AppText>
      <AppCard>
        <AppText tone="secondary">
          Course List 切片将在这里通过 `frontendService.getMaterials()` 加载课程，并通过
          `frontendService.selectLearning()` 加入学习。
        </AppText>
      </AppCard>
    </Screen>
  );
}
