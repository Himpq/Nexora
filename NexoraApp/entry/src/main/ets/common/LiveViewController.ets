// LiveViewController.ets - 实况窗（灵动岛）控制器
// 鸿蒙 LiveView Kit 封装：模型流式回复期间 App 退到后台时，
// 在状态栏灵动岛区域以胶囊态展示"模型正在回复"并随正文滚动；
// 生成完毕后胶囊改为"回复完成"保留 5 秒后自动关闭（回前台/出错则立即关闭）。
//
// 实况窗是系统级增强体验，成功与否不影响主流程：所有 API 调用均做边界错误隔离，
// 失败只打 hilog 不抛异常，避免污染 UIAbility 生命周期回调导致崩溃。

import { liveViewManager } from '@kit.LiveViewKit';
import wantAgent from '@ohos.app.ability.wantAgent';
import { WantAgent } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraLiveView';

// 实况窗唯一标识：本应用只有一个"生成中"实况窗，固定 id 复用
const LIVE_VIEW_ID: number = 1001;

// event 场景：PROGRESS 为通用进度展示场景，语义最贴切"模型正在回复"
const LIVE_VIEW_EVENT: string = 'PROGRESS';

// 胶囊态文案
const CAPSULE_TITLE: string = 'Nexora';
const CAPSULE_CONTENT: string = '模型正在回复';
const CAPSULE_DONE: string = '回复完成';

// 点击实况窗拉回本 App 主 Ability 的目标
const BUNDLE_NAME: string = 'cn.himpqblog.nexoraapp';
const ABILITY_NAME: string = 'EntryAbility';

// 胶囊滚动窗口截取的末尾字数
const CAPSULE_TAIL_LEN: number = 5;

// updateLiveView 节流间隔（ms）：onContentDelta 约 14 帧/秒，
// 实况窗 API 有每秒频率上限（1003500008），150ms 节流到 ~6-7 次/秒安全且视觉流畅
const UPDATE_THROTTLE_MS: number = 150;

// 生成完毕后胶囊保留"回复完成"的时长（ms），到期自动关闭
const DONE_HOLD_MS: number = 5000;

export class LiveViewController {

    // 当前实况窗是否处于活跃状态：幂等控制 start/stop 重复调用
    private active: boolean = false;

    // 上次 updateLiveView 时间戳：节流避免高频触发 API 频率上限
    private lastUpdateAt: number = 0;

    // 上次胶囊显示的末尾文案：内容未变时跳过 update，减少无效 API 调用
    private lastTail: string = '';

    // 缓存首次构造的 clickAction：updateLiveView 复用，避免每次重新 getWantAgent
    private cachedClickAction: WantAgent | null = null;

    // 生成完毕后自动关闭定时器：回前台/出错时清除以立即关闭
    private autoCloseTimer: number = -1;

    static readonly shared: LiveViewController = new LiveViewController();

    // 发布"模型正在回复"实况窗。若已活跃直接返回，保证幂等。
    // 调用方：EntryAbility.onBackground（流式中退后台）
    async startGenerating(): Promise<void> {
        if (this.active) {
            return;
        }

        try {
            const enabled: boolean = await liveViewManager.isLiveViewEnabled();

            if (!enabled) {
                hilog.warn(DOMAIN, TAG, 'liveView disabled by system switch, skip publish');
                return;
            }

            // primary.clickAction 必填：点击胶囊/卡片拉回 App 主 Ability
            const clickAction: WantAgent = await wantAgent.getWantAgent({
                wants: [{
                    bundleName: BUNDLE_NAME,
                    abilityName: ABILITY_NAME
                }],
                operationType: wantAgent.OperationType.START_ABILITY,
                requestCode: 0
            });

            this.cachedClickAction = clickAction;
            this.lastTail = CAPSULE_CONTENT;
            this.lastUpdateAt = Date.now();

            await liveViewManager.startLiveView({
                id: LIVE_VIEW_ID,
                event: LIVE_VIEW_EVENT,
                // App 进程被杀时实况窗自动消失，避免残留
                lifeCycleMode: liveViewManager.LifeCycleMode.AUTO_STOP_WHEN_APP_TERMINATE,
                liveViewData: this.buildLiveViewData(CAPSULE_CONTENT)
            });

            this.active = true;
            hilog.info(DOMAIN, TAG, 'liveView started: capsule showing "%{public}s"', CAPSULE_CONTENT);
        } catch (err) {
            const e: BusinessError = err as BusinessError;
            // 1003500005 = right not enabled：event 场景权限未授权，需去开发者后台申请
            hilog.error(DOMAIN, TAG, 'startLiveView failed code=%{public}d msg=%{public}s', e.code, e.message);
        }
    }

    // 滚动更新胶囊内容：截取正文末尾 5 字显示，随生成推进形成滚动窗口效果。
    // 节流 150ms 避免高频 updateLiveView 触发 API 频率上限。
    // 调用方：MainChat.onContentDelta（每帧正文增量到达时）
    async updateContent(fullText: string): Promise<void> {
        if (!this.active) {
            return;
        }

        const now: number = Date.now();

        if (now - this.lastUpdateAt < UPDATE_THROTTLE_MS) {
            return;
        }

        // 截取末尾 5 字作为胶囊滚动窗口
        const tail: string = fullText.length > CAPSULE_TAIL_LEN
            ? fullText.substring(fullText.length - CAPSULE_TAIL_LEN)
            : fullText;

        if (tail.length === 0 || tail === this.lastTail) {
            return;
        }

        this.lastUpdateAt = now;
        this.lastTail = tail;

        await this.updateLiveViewText(tail);
    }

    // 生成完毕：胶囊改为"回复完成"保留 5 秒后自动关闭。
    // 调用方：MainChat.onComplete（正常完成）
    async finishGenerating(): Promise<void> {
        if (!this.active) {
            return;
        }

        this.lastTail = CAPSULE_DONE;
        await this.updateLiveViewText(CAPSULE_DONE);
        hilog.info(DOMAIN, TAG, 'liveView done: showing "%{public}s", auto close in %{public}dms', CAPSULE_DONE, DONE_HOLD_MS);

        // 5 秒后自动关闭
        this.autoCloseTimer = setTimeout((): void => {
            this.autoCloseTimer = -1;
            this.stopLiveViewNow();
        }, DONE_HOLD_MS);
    }

    // 立即停止实况窗：回前台/出错/取消时调用，清除自动关闭定时器并立即移除。
    // 调用方：EntryAbility.onForeground / MainChat.onError / MainChat.onAborted
    async stop(): Promise<void> {
        if (!this.active) {
            return;
        }

        if (this.autoCloseTimer >= 0) {
            clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = -1;
        }

        await this.stopLiveViewNow();
    }

    // 真正调 stopLiveView 移除实况窗，keepTime=0 彻底清除不留归档
    private async stopLiveViewNow(): Promise<void> {
        try {
            await liveViewManager.stopLiveView({
                id: LIVE_VIEW_ID,
                event: LIVE_VIEW_EVENT,
                liveViewData: {
                    primary: {
                        keepTime: 0
                    }
                }
            });

            this.resetState();
            hilog.info(DOMAIN, TAG, 'liveView stopped');
        } catch (err) {
            const e: BusinessError = err as BusinessError;
            this.resetState();
            hilog.error(DOMAIN, TAG, 'stopLiveView failed code=%{public}d msg=%{public}s', e.code, e.message);
        }
    }

    // 更新胶囊显示指定文本（不节流，直接 updateLiveView）
    private async updateLiveViewText(text: string): Promise<void> {
        try {
            await liveViewManager.updateLiveView({
                id: LIVE_VIEW_ID,
                event: LIVE_VIEW_EVENT,
                liveViewData: this.buildLiveViewData(text)
            });
        } catch (err) {
            const e: BusinessError = err as BusinessError;
            hilog.error(DOMAIN, TAG, 'updateLiveView failed code=%{public}d msg=%{public}s', e.code, e.message);
        }
    }

    // 构造 LiveViewData：胶囊文本 + primary 固定结构（clickAction/layoutData 必填）
    private buildLiveViewData(text: string): liveViewManager.LiveViewData {
        return {
            primary: {
                title: CAPSULE_TITLE,
                content: [{ text: text }],
                clickAction: this.cachedClickAction!,
                layoutData: {
                    layoutType: liveViewManager.LayoutType.LAYOUT_TYPE_DEFAULT,
                    progress: 0
                }
            },
            capsule: {
                type: liveViewManager.CapsuleType.CAPSULE_TYPE_TEXT,
                status: 1,
                title: CAPSULE_TITLE,
                content: text,
                icon: 'liveview_icon.png',
                backgroundColor: '#FF372B55'
            }
        };
    }

    // 重置内部状态：stop/失败后复用
    private resetState(): void {
        this.active = false;
        this.cachedClickAction = null;
        this.lastTail = '';
        this.lastUpdateAt = 0;
    }
}
