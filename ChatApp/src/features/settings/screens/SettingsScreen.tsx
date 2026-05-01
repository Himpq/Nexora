import { appEnv } from "../../../config/env";
import { AppCard, AppText, Screen } from "../../../design";

export function SettingsScreen() {
  return (
    <Screen scroll>
      <AppText variant="title">设置</AppText>
      <AppCard>
        <AppText variant="heading">应用信息</AppText>
        <AppText tone="secondary">版本：0.1.0</AppText>
        <AppText tone="secondary">API 基地址：{appEnv.nexoraLearningBaseUrl}</AppText>
      </AppCard>
      <AppCard>
        <AppText tone="secondary">
          用户上下文、角色判断和后端连通性检查从 0.2.0 开始接入。
        </AppText>
      </AppCard>
    </Screen>
  );
}
