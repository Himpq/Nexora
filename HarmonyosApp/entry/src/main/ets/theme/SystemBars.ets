/**
 * 系统栏与页面主题同步（2026-09-21 审查 P2-6）。
 * 原先只有阅读器在进入沉浸时设置过一次系统栏颜色，主页面切换系统深浅色后状态栏仍是旧色。
 * 这里集中管理：EntryAbility 在窗口创建与 colorMode 变化时调用；阅读器退出沉浸时调用一次交还。
 */
import { window } from '@kit.ArkUI';
import { nxPalette } from './DesignTokens';

export function nxApplySystemBars(win: window.Window, dark: boolean): void {
  const palette = nxPalette(dark);
  const home = AppStorage.get<boolean>('nxHomeVisible') === true && AppStorage.get<boolean>('nxAuthenticated') === true;
  try {
    win.setWindowSystemBarProperties({
      statusBarColor: home ? '#00000000' : palette.pageBg,
      navigationBarColor: home ? '#00000000' : palette.pageBg,
      statusBarContentColor: palette.text1,
      navigationBarContentColor: palette.text1,
    }).catch((err: Error) => {
    });
  } catch (err) {
    // 窗口尚未就绪时忽略；下一次 colorMode 变化再同步
  }
}
