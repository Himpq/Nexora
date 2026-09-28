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
import { nxApplySystemBars } from '../theme/SystemBars';
import { sharedGlowPreferences } from '../theme/GlowPreferences';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  private agentApi: AgentApi = new AgentApi();
  private mainWindow: window.Window | undefined = undefined;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // 意图框架：把三条意图的执行器挂进依赖图（装饰器只在被依赖的文件里参与编译）。
    hilog.info(DOMAIN, 'nxIntent', 'intents: %{public}s (%{public}d executors)',
      NEXORA_INTENT_NAMES.join(','), nexoraIntentExecutors().length);
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
      // 环境与身份：config/Env.ets 决定云端/本地；Identity 决定用户名（本机身份或华为账号）。
      Identity.resolve(this.context).catch((err: Error) => {
        hilog.warn(DOMAIN, 'testTag', 'identity resolve failed: %{public}s', err.message);
      });
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
    sharedGlowPreferences.init(this.context);
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
    const systemDark: boolean | undefined = newConfig.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK ? true :
      (newConfig.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT ? false : undefined);
    sharedGlowPreferences.refresh(systemDark);
    const dark: boolean = AppStorage.get<boolean>('nxDarkMode') === true;
    // 2026-09-21 审查 P2-6：页面随系统深浅色变了，状态栏 / 导航栏也要一起变（阅读器沉浸时由它自管）。
    if (this.mainWindow !== undefined && AppStorage.get<boolean>('nxReaderImmersive') !== true) {
      nxApplySystemBars(this.mainWindow, dark);
    }
    hilog.info(DOMAIN, 'testTag', 'colorMode changed, nxDarkMode=%{public}s', dark ? 'true' : 'false');
  }

  onDestroy(): void {
    sharedGlowPreferences.dispose();
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    windowStage.loadContent('pages/Index', (err) => {
      // 软键盘避让（2026-09-21 审查 F05）：全局用压缩模式（官方 FAQ faqs-arkui-53），登录页、
      // 今日复习、闭环小测的输入框都由系统避让；主对话与阅读器需要沉浸 / 自定义布局，
      // 各自在进入时切到 NONE 并按键盘高度自管，离开时交还 RESIZE。
      const win: window.Window = windowStage.getMainWindowSync();
      this.mainWindow = win;
      sharedGlowPreferences.attachWindow(win);
      const uiContext: UIContext = win.getUIContext();
      uiContext.setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
      nxApplySystemBars(win, AppStorage.get<boolean>('nxDarkMode') === true);
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
    });
  }

  onWindowStageDestroy(): void {
    this.mainWindow = undefined;
    sharedGlowPreferences.attachWindow(undefined);
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
    sharedGlowPreferences.setForeground(true);
    // 回前台：日期标签（今天 / 昨天）与列表可能跨过午夜，让主页面重算一次。
    AppStorage.setOrCreate('nxForegroundTick', Date.now());
    // 前台是设备上下文最可靠的采样点；服务自身按 15 分钟去重，避免每次切前台都请求。
    sharedDeviceContext.report(this.context, this.agentApi).catch((err: Error) => {
      hilog.debug(DOMAIN, 'testTag', 'device context report skipped: %{public}s', err.message);
    });
  }

  onBackground(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
    sharedGlowPreferences.setForeground(false);
  }
}
