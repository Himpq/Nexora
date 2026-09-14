import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
// 注意：KeyboardAvoidMode 与 SDK 中组件属性用全局枚举（component/common.d.ts，仅 DEFAULT/NONE）同名，
// 直接 import 会被全局声明遮蔽导致取不到 RESIZE，故用别名绑定 UIContext 版（含 OFFSET/RESIZE/...）
import { KeyboardAvoidMode as KeyboardAvoid, UIContext, window } from '@kit.ArkUI';
import { chatStream } from '../common/ChatStreamClient';
import { LiveViewController } from '../common/LiveViewController';

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
  // 2. 窗口走沉浸式布局：系统不再替页面避让状态栏与手势区，页面 100% 才是真正的整屏高度。
  //    此前用非沉浸式布局 + 组件 expandSafeArea 想把手势区涂满，是无效的——
  //    窗口不处于全屏布局时 expandSafeArea 突破不了安全区，底部手势区没有任何组件能绘制到，
  //    于是出现「内容只铺到 95%、剩下 5% 空着」的白带。
  // 3. 避让高度在此统一量一次并发布到 AppStorage，由应用根节点（Index）垫付顶部，
  //    底部锚定的组件自行消费；业务页面不各自读窗口 API。
  private async applyWindowChrome(windowStage: window.WindowStage): Promise<void> {
    try {
      const win: window.Window = windowStage.getMainWindowSync();

      await win.setWindowLayoutFullScreen(true);
      // 键盘避让模式在 UIContext 上设置（KeyboardAvoidMode 枚举从 @kit.ArkUI 顶层导入）：
      // RESIZE = 输入法弹出时压缩可用高度，避免标题栏被顶飞、输入栏被键盘覆盖
      win.getUIContext().setKeyboardAvoidMode(KeyboardAvoid.RESIZE);

      const isDark: boolean = this.context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      const barContent: string = isDark ? '#9AA1B0' : '#676E7D';

      // 两条系统栏底色一律透明：状态栏与手势区都交给当前页面的底色填充，不再由系统补色
      win.setWindowSystemBarProperties({
        statusBarColor: '#00000000',
        statusBarContentColor: barContent,
        navigationBarColor: '#00000000',
        navigationBarContentColor: barContent
      });

      this.publishInsets(win);

      hilog.info(DOMAIN, 'testTag', 'window chrome applied, dark=%{public}s', isDark ? 'yes' : 'no');
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'applyWindowChrome failed: %{public}s', JSON.stringify(err));
    }
  }

  // 把避让高度换算成 vp 后发布：手势导航看导航条区域，三键导航看系统栏区域，取两者底部较大值
  private publishInsets(win: window.Window): void {
    const ui: UIContext = win.getUIContext();
    const statusArea: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
    const indicatorArea: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);

    const insetTop: number = ui.px2vp(statusArea.topRect.height);
    const insetBottom: number = Math.max(ui.px2vp(statusArea.bottomRect.height), ui.px2vp(indicatorArea.bottomRect.height));

    AppStorage.setOrCreate('insetTop', insetTop);
    AppStorage.setOrCreate('insetBottom', insetBottom);
    hilog.info(DOMAIN, 'testTag', 'safe insets top=%{public}s bottom=%{public}s',
      insetTop.toFixed(1), insetBottom.toFixed(1));
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');

    // 回前台：停止"模型正在回复"实况窗（若未活跃则幂等返回）
    LiveViewController.shared.stop();
  }

  onBackground(): void {
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');

    // 流式回复进行中退到后台：发布实况窗在灵动岛胶囊态提示"模型正在回复"
    if (chatStream.isStreaming) {
      LiveViewController.shared.startGenerating();
    }
  }
}
