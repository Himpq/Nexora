/**
 * 实况窗（重构方案 §二·第二步 · Live View Kit）：锁屏与状态栏胶囊上「正在读第 6 章 · 3/7 节」。
 * 事实依据（本地文档 liveview-create-locally / liveViewManager）：
 *   liveViewManager.isLiveViewEnabled() → startLiveView(view) / updateLiveView(view) / stopLiveView(view)
 *   LiveView { id, event, isMute, liveViewData: { primary: { title, content[], keepTime, layoutData: { layoutType } } } }
 *   event 场景需申请权益；未获权益的设备上 startLiveView 抛错，这里静默降级，不影响主线。
 * 两种场景：学习会话进行中（TIMER，随阅读器开合）；夜间备课进度（由后端 Push Kit 更新，本文件只做端侧起停）。
 * 应用必须在前台才能创建实况窗，所以只在用户点「好」进入阅读器的那一刻创建。
 */
import { liveViewManager } from '@kit.LiveViewKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0000;
const STUDY_VIEW_ID: number = 2601;

export class LiveViewService {
  private active: boolean = false;
  private chapter: string = '';

  private buildView(title: string, content: string, keepTime: number): liveViewManager.LiveView {
    const view: liveViewManager.LiveView = {
      id: STUDY_VIEW_ID,
      event: 'TIMER',
      isMute: true,
      liveViewData: {
        primary: {
          title: title,
          content: [{ text: content }],
          keepTime: keepTime,
          layoutData: {
            layoutType: liveViewManager.LayoutType.LAYOUT_TYPE_PICKUP,
          },
        },
      },
    };
    return view;
  }

  /** 进入阅读器：状态栏胶囊显示「Nexora · 在读 X」。 */
  async startStudy(chapter: string, minutes: number): Promise<boolean> {
    try {
      const enabled: boolean = await liveViewManager.isLiveViewEnabled();
      if (!enabled) {
        return false;
      }
      this.chapter = chapter;
      const view = this.buildView('Nexora 在陪你读 ' + chapter, '计划 ' + minutes + ' 分钟 · 读完我出题', 0);
      await liveViewManager.startLiveView(view);
      this.active = true;
      return true;
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, 'nxLiveView', 'start skipped %{public}d %{public}s', e.code, e.message);
      return false;
    }
  }

  /** 阅读进度更新：「第 3/7 节」。 */
  async updateStudy(sectionIndex: number, sectionTotal: number): Promise<void> {
    if (!this.active) {
      return;
    }
    try {
      const view = this.buildView('Nexora 在陪你读 ' + this.chapter, '第 ' + sectionIndex + '/' + sectionTotal + ' 节', 0);
      await liveViewManager.updateLiveView(view);
    } catch (err) {
      // 更新失败不影响阅读
    }
  }

  /** 离开阅读器：结束并存档 1 分钟。 */
  async stopStudy(summary: string): Promise<void> {
    if (!this.active) {
      return;
    }
    this.active = false;
    try {
      const view = this.buildView('Nexora 读完了 ' + this.chapter, summary, 1);
      await liveViewManager.stopLiveView(view);
    } catch (err) {
      // 已被系统关闭时忽略
    }
  }
}

export const sharedLiveView: LiveViewService = new LiveViewService();
