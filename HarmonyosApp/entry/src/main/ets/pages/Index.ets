/**
 * Nexora · 单界面壳（重构方案 §二·第三步）。
 * 三 Tab 已收缩为一条时间轴「它的一天」；书房与「它眼里的你」都是从这一屏滑出的抽屉。
 * 意图 / 通知 / 卡片唤醒统一回到这一屏（EntryAbility 写入 nxLaunchRoute / nxLaunchDecision）。
 */
import { DayView } from './Day';
import { nxPalette, NxPalette } from '../theme/DesignTokens';

@Entry
@Component
struct Index {
  @StorageProp('nxDarkMode') nxDark: boolean = false;

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  /**
   * 从书房推入的页面（阅读器 / 今日任务 / 学习报告）返回时，先回到书房抽屉而不是主界面。
   * 推页时抽屉会被系统收起，这里据 nxReturnToStudy 重新拉起，并通知书房刷新进度。
   */
  onPageShow(): void {
    const back: boolean = AppStorage.get<boolean>('nxReturnToStudy') === true;
    if (back) {
      AppStorage.setOrCreate('nxReturnToStudy', false);
      AppStorage.setOrCreate('nxStudyTick', Date.now());
      // 先置 false 再置 true：推页时抽屉若未被系统收起，状态仍是 true，直接置 true 不会重新展示。
      AppStorage.setOrCreate('nxStudyOpen', false);
      setTimeout(() => {
        AppStorage.setOrCreate('nxStudyOpen', true);
      }, 120);
    }
  }

  build() {
    Column() {
      DayView()
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.palette().pageBg)
  }
}
