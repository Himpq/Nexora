import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
// 注意：KeyboardAvoidMode 与 SDK 中组件属性用全局枚举（component/common.d.ts，仅 DEFAULT/NONE）同名，
// 直接 import 会被全局声明遮蔽导致取不到 RESIZE，故用别名绑定 UIContext 版（含 OFFSET/RESIZE/...）
import { KeyboardAvoidMode as KeyboardAvoid, window } from '@kit.ArkUI';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
      // 主窗口就绪后再统一配置键盘避让与系统栏外观（loadContent 完成前拿不到主窗口）
      this.applyWindowChrome(windowStage);
    });

    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
  }

  // 键盘与系统栏统一配置：
  // 1. 输入法弹出改为「压缩可用高度」而不是默认的整体上移/悬浮——
  //    避免聊天页标题栏被顶出屏幕、输入栏（模型选择/发送按钮）被键盘盖住
  // 2. 状态栏/导航栏（手势条）颜色对齐页面底色，消除底部白边；深浅两套色值取自 color.json
  private applyWindowChrome(windowStage: window.WindowStage): void {
    try {
      const win: window.Window = windowStage.getMainWindowSync();
      // 键盘避让模式在 UIContext 上设置（KeyboardAvoidMode 枚举从 @kit.ArkUI 顶层导入）：
      // RESIZE = 输入法弹出时压缩可用高度，避免标题栏被顶飞、输入栏被键盘覆盖
      win.getUIContext().setKeyboardAvoidMode(KeyboardAvoid.RESIZE);

      const isDark: boolean = this.context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      const barBg: string = isDark ? '#0E1015' : '#F4F5F9';
      const barContent: string = isDark ? '#9AA1B0' : '#676E7D';

      win.setWindowSystemBarProperties({
        statusBarColor: barBg,
        statusBarContentColor: barContent,
        navigationBarColor: barBg,
        navigationBarContentColor: barContent
      });
      hilog.info(DOMAIN, 'testTag', 'window chrome applied, dark=%{public}s', isDark ? 'yes' : 'no');
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'applyWindowChrome failed: %{public}s', JSON.stringify(err));
    }
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}