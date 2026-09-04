/*
 * Copyright (c) 2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AbilityConstant, Configuration, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { KeyboardAvoidMode, UIContext, window } from '@kit.ArkUI';
import { Identity } from '../services/Identity';
import { AgentApi } from '../services/AgentApi';
import { sharedDeviceContext } from '../capability/context';
import { NEXORA_INTENT_NAMES, nexoraIntentExecutors } from '../intents/index';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  private agentApi: AgentApi = new AgentApi();

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // 意图框架：把三条意图的执行器挂进依赖图（装饰器只在被依赖的文件里参与编译）。
    hilog.info(DOMAIN, 'nxIntent', 'intents: %{public}s (%{public}d executors)',
      NEXORA_INTENT_NAMES.join(','), nexoraIntentExecutors().length);
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
      // §8 深色令牌标记：跟随系统深浅色，主题只在 theme/ 里切换。
      const dark: boolean = this.context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      AppStorage.setOrCreate('nxDarkMode', dark);
      // 环境与身份：config/Env.ets 决定云端/本地；Identity 决定用户名（本机身份或华为账号）。
      Identity.resolve(this.context).catch((err: Error) => {
        hilog.warn(DOMAIN, 'testTag', 'identity resolve failed: %{public}s', err.message);
      });
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
    // 从意图框架 / 卡片 / 通知拉起时，把落点写进 AppStorage，首页据此直达。
    this.rememberLaunchTarget(want);
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.rememberLaunchTarget(want);
  }

  private rememberLaunchTarget(want: Want): void {
    if (want.parameters === undefined) {
      return;
    }
    const params: Record<string, Object> = want.parameters as Record<string, Object>;
    const route: Object | undefined = params['nx_route'];
    if (route !== undefined) {
      AppStorage.setOrCreate('nxLaunchRoute', String(route));
    }
    const decisionId: Object | undefined = params['decision_id'];
    if (decisionId !== undefined) {
      AppStorage.setOrCreate('nxLaunchDecision', String(decisionId));
    }
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    const dark: boolean = newConfig.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    AppStorage.setOrCreate('nxDarkMode', dark);
    hilog.info(DOMAIN, 'testTag', 'colorMode changed, nxDarkMode=%{public}s', dark ? 'true' : 'false');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    windowStage.loadContent('pages/Index', (err) => {
      // 软键盘避让：压缩模式（官方 FAQ faqs-arkui-53 示例），
      // 否则底部输入栏/阅读器底栏会被键盘完全遮挡。
      const uiContext: UIContext = windowStage.getMainWindowSync().getUIContext();
      uiContext.setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
    // 前台是设备上下文最可靠的采样点；服务自身按 15 分钟去重，避免每次切前台都请求。
    sharedDeviceContext.report(this.context, this.agentApi).catch((err: Error) => {
      hilog.debug(DOMAIN, 'testTag', 'device context report skipped: %{public}s', err.message);
    });
  }

  onBackground(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
