// TurnIndicatorPanel.ets - 对话轮次指示器（对齐 NexoraWeb TurnIndicatorPanel）
// 右侧垂直居中的横线列表，每条横线代表一轮用户对话：
//  - 全部轮次线常驻（键只取绝对轮次，颜色不随激活变化 → 滚动跨轮不会重建线条）；
//  - 激活线由单条高亮行绘制，靠 translate 移动（O(1)，动画平滑）；
//  - 线条整体平移把激活线带回 8 行窗口中部，对齐 web 的 scrollActiveLineIntoView('center')，
//    首尾无法居中时夹紧，窗口内不露空白（对齐 web 的 nearest/夹紧语义）；
//  - 点击面板展开预览浮层，点击预览项跳转到对应用户消息。

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
    // 线条键：全部轮次常驻，只在轮次总数变化时重建
    @State private lineKeys: string[] = [];
    // 预览浮层显隐动画：始终挂载，用 width+opacity 属性动画控制（避免 if 卸载退场动画失效）
    @State private previewWidth: number = 0;
    @State private previewOpacity: number = 0;
    // 预览列表高亮用的下标：只在展开时跟随 activeIndex。
    // 直接用 activeIndex 会让「收起状态下每次跨轮都重跑全部预览条目」（长会话上百条）→ 滚动掉帧
    @State private shownActiveIndex: number = -1;


    private previewScroller: Scroller = new Scroller();

    aboutToAppear(): void {
        this.rebuildLineKeys();
        this.previews = this.onRequirePreviews();
    }

    // 轮次数变化（发新消息 / 补载历史）才刷新线条与预览列表
    private onTurnCountChange(): void {
        this.rebuildLineKeys();
        this.previews = this.onRequirePreviews();
    }

    // 激活轮次变化：只有预览浮层展开时才同步给预览列表（收起时不需要，也就不会触发条目重建）
    private onActiveIndexChange(): void {
        if (this.expanded) {
            this.shownActiveIndex = this.activeIndex;
        }
    }

    private rebuildLineKeys(): void {
        const keys: string[] = [];

        for (let i: number = 0; i < this.turnCount; i++) {
            keys.push('turn_' + i);
        }

        this.lineKeys = keys;
    }

    private lineStep(): number {
        return LINE_HEIGHT + LINE_GAP;
    }

    // 面板可视区高度：固定 8 行（对齐 web 的窗口尺寸，超出部分裁掉）
    private boxHeight(): number {
        return PANEL_MAX_LINES * LINE_HEIGHT + (PANEL_MAX_LINES - 1) * LINE_GAP;
    }

    // 线条整体平移量：使激活线落在窗口中心（对齐 web align='center'）；
    // 首尾无法居中时夹紧到 [箱高-列高, 0]，避免窗口内露出空白
    private linesTranslate(): number {
        if (this.activeIndex < 0 || this.turnCount === 0) {
            return 0;
        }

        const ideal: number = ((PANEL_MAX_LINES - 1) / 2 - this.activeIndex) * this.lineStep();
        const columnHeight: number = this.turnCount * LINE_HEIGHT + (this.turnCount - 1) * LINE_GAP;
        const limit: number = Math.min(0, this.boxHeight() - columnHeight);

        return Math.max(limit, Math.min(0, ideal));
    }

    // 高亮行自身位移：移到激活线位置（与线条平移叠加后正好落在窗口中部或夹紧后的边界）
    private highlightTranslate(): number {
        if (this.activeIndex < 0) {
            return 0;
        }

        return this.activeIndex * this.lineStep();
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
        this.shownActiveIndex = this.activeIndex;
        this.expanded = true;
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            this.previewWidth = PREVIEW_WIDTH;
            this.previewOpacity = 1;
        });
        // 动画完成后布局稳定，把当前轮次滚到预览列表中部（对齐 web showTurnListPopup）
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

        // 先完成预览层收起，再让主列表定位；两个动画同时运行会把列表跳转拖成长距离滚动。
        setTimeout(() => {
            if (!this.expanded) {
                this.onJump(index);
            }
        }, Motion.durationBase + 16);
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
        .height('100%')
        // 收起时只有右侧横线面板需要接收点击，整块全屏区域必须透传给下方聊天 List；
        // 展开时保留全屏命中，用于点击预览浮层外围关闭它。
        .hitTestBehavior(this.expanded ? HitTestMode.Default : HitTestMode.None);
    }

    // 横线面板：固定 8 行高的裁切窗口，内部整列线条平移，让激活线始终回到窗口中部
    @Builder
    LinePanel() {
        Column() {
            Stack() {
                Stack() {
                    // 线：每轮一条，键只取绝对轮次，颜色与激活无关 → 滚动跨轮时不重建任何线条
                    Column({ space: LINE_GAP }) {
                        ForEach(this.lineKeys, (key: string, index: number) => {
                            Row()
                                .width('100%')
                                .height(LINE_HEIGHT)
                                .borderRadius(LINE_HEIGHT / 2)
                                .backgroundColor($r('app.color.divider'));
                        }, (key: string) => key);
                    }
                    .width('100%');

                    // 高亮：单行常驻，靠 translate 移到激活线位置（动画由宿主 animateTo 包裹时播放，
                    // 对齐 web「滚动不播动画、跳转才播」）
                    if (this.activeIndex >= 0 && this.activeIndex < this.turnCount) {
                        Row()
                            .width('100%')
                            .height(LINE_HEIGHT)
                            .borderRadius(LINE_HEIGHT / 2)
                            .backgroundColor($r('app.color.brand_primary'))
                            .translate({ y: this.highlightTranslate() });
                    }
                }
                .width('100%')
                .alignContent(Alignment.Top)
                .translate({ y: this.linesTranslate() });
            }
            .width(24)
            .height(this.boxHeight())
            .alignContent(Alignment.Top)
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

    // 预览浮层：始终挂载，用 width+opacity 动画控制显隐（避免 if 卸载退场动画偏移）
    // 使用 List 而非 Scroll+Column：scrollToIndex 仅支持 List/Grid/Swiper
    @Builder
    PreviewList() {
        List({ scroller: this.previewScroller, space: Space.xxs }) {
            ForEach(this.previews, (preview: string, index: number) => {
                ListItem() {
                    Row() {
                        Text(preview.length > 0 ? preview : '(空消息)')
                            .fontSize(FontSize.small)
                            .fontColor(index === this.shownActiveIndex
                                ? $r('app.color.brand_primary')
                                : $r('app.color.text_secondary'))
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .layoutWeight(1);
                    }
                    .width('100%')
                    .padding({ left: Space.md, right: Space.md, top: Space.sm, bottom: Space.sm })
                    .backgroundColor(index === this.shownActiveIndex
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
