import { AppCard, AppText, Screen } from "../../../design";

export function BookUploadScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">上传教材</AppText>
      <AppCard>
        <AppText tone="secondary">上传成功后不要假设已提炼完成，需要明确显示等待处理状态。</AppText>
      </AppCard>
    </Screen>
  );
}
