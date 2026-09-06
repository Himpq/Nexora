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
    @Prop @Watch('onPropsChange') turnCount: number;
    // 当前激活轮次索引（-1 表示无）
    @Prop @Watch('onPropsChange') activeIndex: number;
    // 跳转回调：传入轮次索引
    onJump: (index: number) => void = () => {};
    // 按需获取预览文本列表
    onRequirePreviews: () => string[] = () => [];

    @State private expanded: boolean = false;
    @State private previews: string[] = [];
    @State private lineKeys: string[] = [];
    // 预览浮层显隐动画：始终挂载，用 width+opacity 属性动画控制（避免 if 卸载退场动画失效）
    @State private previewWidth: number = 0;
    @State private previewOpacity: number = 0;


    private previewScroller: Scroller = new Scroller();

    aboutToAppear(): void {
        this.rebuildLineKeys();
        this.previews = this.onRequirePreviews();
    }

    // turnCount 或 activeIndex 变化时同步刷新横线 key 和预览列表，
    // 确保分块加载更多消息后预览列表与实际消息一致
    private onPropsChange(): void {
        this.rebuildLineKeys();
        this.previews = this.onRequirePreviews();
    }

    private rebuildLineKeys(): void {
        const keys: string[] = [];
        for (let i: number = 0; i < this.turnCount; i++) {
            keys.push('turn_' + i);
        }
        this.lineKeys = keys;
    }

    // 展开：先刷新预览列表，再动画展开宽度+透明度，布局就绪后滚动到当前轮次；收起：反向动画
    // 预览列表缓存于 @State previews：onPropsChange 在 turnCount/activeIndex 变化时同步刷新，
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
                            .backgroundColor(index === this.activeIndex
                                ? $r('app.color.brand_primary')
                                : $r('app.color.divider'));
                    }, (key: string, index: number) => key + '_' + this.activeIndex);
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

    // 计算横线列表平移量：使高亮线尽量居中，列表头尾贴边不露出空白
    private computeLineTranslate(): number {
        if (this.turnCount <= PANEL_MAX_LINES || this.activeIndex < 0) {
            return 0;
        }

        const itemStep: number = LINE_HEIGHT + LINE_GAP;
        const centerOffset: number = (PANEL_MAX_LINES - 1) / 2;
        let translate: number = -(this.activeIndex - centerOffset) * itemStep;

        // 限制平移范围：列表头尾不露出空白
        const minTranslate: number = -((this.turnCount - PANEL_MAX_LINES) * itemStep);

        if (translate > 0) {
            translate = 0;
        }

        if (translate < minTranslate) {
            translate = minTranslate;
        }

        return translate;
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
