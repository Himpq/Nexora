// TurnIndicatorPanel.ets - 对话轮次指示器
// 参考 NexoraWeb TurnIndicatorPanel：右侧垂直居中的横线列表，每条横线代表一轮用户对话
// 当前阅读轮次高亮，点击面板展开预览浮层，点击预览项跳转到对应用户消息

import { FontSize, Motion, Radius, Shadow, Space } from '../../common/DesignToken';

const LINE_HEIGHT: number = 3;
const LINE_GAP: number = 3;
const PANEL_MAX_LINES: number = 8;
const PREVIEW_WIDTH: number = 200;

@Component
export struct TurnIndicatorPanel {
    // 总轮次数（用户消息条数）
    @Prop @Watch('onTurnCountChange') turnCount: number;
    // 当前激活轮次索引（-1 表示无）：滚动跨过用户消息时高频变化
    @Prop @Watch('onActiveIndexChange') activeIndex: number;
    // 跳转回调：传入轮次索引
    onJump: (index: number) => void = () => {};
    // 按需获取预览文本列表
    onRequirePreviews: () => string[] = () => [];

    @State private expanded: boolean = false;
    @State private previews: string[] = [];
    // 横线窗口：只渲染激活轮次附近的 PANEL_MAX_LINES 条（key + 起始索引）
    @State private lineKeys: string[] = [];
    @State private lineStart: number = 0;
    // 预览浮层显隐动画：始终挂载，用 width+opacity 属性动画控制（避免 if 卸载退场动画失效）
    @State private previewWidth: number = 0;
    @State private previewOpacity: number = 0;


    private previewScroller: Scroller = new Scroller();

    aboutToAppear(): void {
        this.rebuildLineWindow();
        this.previews = this.onRequirePreviews();
    }

    // 轮次数变化（发新消息 / 补载历史）才刷新横线窗口与预览列表
    private onTurnCountChange(): void {
        this.rebuildLineWindow();
        this.previews = this.onRequirePreviews();
    }

    // 激活轮次变化（快速滚动跨过用户消息时每轮触发一次）：
    // 只重建窗口内最多 8 条横线，绝不重扫消息生成预览。
    // 旧实现把 activeIndex 编进全部横线的 key 并在此 O(n) 重扫消息刷新预览，
    // 长会话下每次跨过用户消息都会整体销毁重建几百条横线 → 滚动突然卡顿、指示条跳动
    private onActiveIndexChange(): void {
        this.rebuildLineWindow();
    }

    // 重建横线窗口：仅保留激活轮次附近 PANEL_MAX_LINES 条，
    // 窗口起点夹紧在 [0, turnCount - size]，保证列表头尾不露出空白
    private rebuildLineWindow(): void {
        const total: number = this.turnCount;
        const size: number = Math.min(total, PANEL_MAX_LINES);

        if (size <= 0) {
            this.lineStart = 0;
            this.lineKeys = [];
            return;
        }

        let start: number = 0;

        if (this.activeIndex >= 0) {
            start = this.activeIndex - Math.floor((size - 1) / 2);
        }

        start = Math.max(0, Math.min(start, total - size));
        this.lineStart = start;

        const keys: string[] = [];

        for (let i: number = 0; i < size; i++) {
            keys.push('turn_' + (start + i));
        }

        this.lineKeys = keys;
    }

    // 展开：先刷新预览列表，再动画展开宽度+透明度，布局就绪后滚动到当前轮次；收起：反向动画
    // 预览列表缓存于 @State previews：turnCount 变化（发消息/补载历史）时刷新，
    // 展开时再刷新一次确保内容最新；ForEach 监听 @State previews 触发重建
    private toggleExpand(): void {
        if (this.expanded) {
            this.expanded = false;
            animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
                this.previewWidth = 0;
                this.previewOpacity = 0;
            });
            return;
        }

        this.previews = this.onRequirePreviews();
        this.expanded = true;
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            this.previewWidth = PREVIEW_WIDTH;
            this.previewOpacity = 1;
        });
        // 动画完成后布局稳定，滚动到当前轮次居中
        setTimeout(() => {
            if (this.expanded) {
                this.previewScroller.scrollToIndex(this.activeIndex, true, ScrollAlign.CENTER);
            }
        }, Motion.durationBase + 50);
    }

    private handleJump(index: number): void {
        this.expanded = false;
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            this.previewWidth = 0;
            this.previewOpacity = 0;
        });
        this.onJump(index);
    }

    build() {
        Stack() {
            // 展开时全屏透明遮罩：点击任意外围区域关闭预览浮层
            if (this.expanded) {
                Row()
                    .width('100%')
                    .height('100%')
                    .onClick(() => {
                        this.toggleExpand();
                    });
            }

            Row({ space: Space.xs }) {
                this.PreviewList();

                this.LinePanel();
            }
            .alignItems(VerticalAlign.Center);
        }
        .alignContent(Alignment.End)
        .width('100%')
        .height('100%');
    }

    // 横线面板：固定8条高度 + clip 裁剪 + translate 动画使高亮线居中（对齐 NexoraWeb scrollActiveLineIntoView center 语义）
    @Builder
    LinePanel() {
        Column() {
            Stack() {
                Column({ space: LINE_GAP }) {
                    ForEach(this.lineKeys, (key: string, index: number) => {
                        Row()
                            .width('100%')
                            .height(LINE_HEIGHT)
                            .borderRadius(LINE_HEIGHT / 2)
                            .backgroundColor(this.lineStart + index === this.activeIndex
                                ? $r('app.color.brand_primary')
                                : $r('app.color.divider'));
                    // key 并入高亮态：ForEach 同 key 行不会重跑构建，高亮切换需靠 key 变化重建该行
                    }, (key: string, index: number) => key + '_' + (this.lineStart + index === this.activeIndex ? 'on' : 'off'));
                }
                .width('100%')
                .translate({ y: this.computeLineTranslate() })
                .animation({ duration: Motion.durationBase, curve: Motion.easeOut });
            }
            .width(24)
            .height(PANEL_MAX_LINES * LINE_HEIGHT + (PANEL_MAX_LINES - 1) * LINE_GAP)
            .clip(true);
        }
        .padding({ top: Space.sm, bottom: Space.sm, left: Space.xs, right: Space.xs })
        .backgroundColor($r('app.color.bg_card'))
        .borderRadius(Radius.md)
        .shadow(Shadow.card)
        .onClick(() => {
            this.toggleExpand();
        });
    }

    // 计算横线窗口平移量：使高亮线尽量居中，窗口起点已夹紧保证头尾贴边不露空白
    private computeLineTranslate(): number {
        if (this.turnCount <= PANEL_MAX_LINES || this.activeIndex < 0) {
            return 0;
        }

        const itemStep: number = LINE_HEIGHT + LINE_GAP;
        const centerOffset: number = (PANEL_MAX_LINES - 1) / 2;
        const position: number = this.activeIndex - this.lineStart;
        const translate: number = (centerOffset - position) * itemStep;

        return translate > 0 ? 0 : translate;
    }

    // 预览浮层：始终挂载，用 width+opacity 动画控制显隐（避免 if 卸载退场动画偏移）
    // 使用 List 而非 Scroll+Column：scrollToIndex 仅支持 List/Grid/Swiper
    // ForEach 监听 @State previews：onPropsChange 和 toggleExpand 会刷新 previews，
    // 确保分块加载更多消息后预览列表与实际消息同步，避免跳转错位
    @Builder
    PreviewList() {
        List({ scroller: this.previewScroller, space: Space.xxs }) {
            ForEach(this.previews, (preview: string, index: number) => {
                ListItem() {
                    Row() {
                        Text(preview.length > 0 ? preview : '(空消息)')
                            .fontSize(FontSize.small)
                            .fontColor(index === this.activeIndex
                                ? $r('app.color.brand_primary')
                                : $r('app.color.text_secondary'))
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .layoutWeight(1);
                    }
                    .width('100%')
                    .padding({ left: Space.md, right: Space.md, top: Space.sm, bottom: Space.sm })
                    .backgroundColor(index === this.activeIndex
                        ? $r('app.color.bg_sunken')
                        : Color.Transparent)
                    .borderRadius(Radius.sm)
                    .onClick(() => {
                        this.handleJump(index);
                    });
                }
            }, (preview: string, index: number) => index + '_' + preview);
        }
        .width(this.previewWidth)
        .constraintSize({ maxHeight: 300 })
        .padding({ top: Space.xs, bottom: Space.xs })
        .backgroundColor($r('app.color.bg_card'))
        .borderRadius(Radius.md)
        .shadow(Shadow.raised)
        .scrollBar(BarState.Off)
        .opacity(this.previewOpacity)
        .hitTestBehavior(this.expanded ? HitTestMode.Default : HitTestMode.None);
    }
}
