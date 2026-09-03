// TurnIndicatorPanel.ets - 对话轮次指示器
// 参考 NexoraWeb TurnIndicatorPanel：右侧垂直居中的横线列表，每条横线代表一轮用户对话
// 当前阅读轮次高亮，点击面板展开预览浮层，点击预览项跳转到对应用户消息

import { FontSize, Radius, Shadow, Space } from '../../common/DesignToken';

const LINE_HEIGHT: number = 3;
const LINE_GAP: number = 3;
const PANEL_MAX_LINES: number = 8;

@Component
export struct TurnIndicatorPanel {
    // 总轮次数（用户消息条数）
    @Prop @Watch('onTurnCountChange') turnCount: number;
    // 当前激活轮次索引（-1 表示无）
    @Prop activeIndex: number;
    // 跳转回调：传入轮次索引
    onJump: (index: number) => void = () => {};
    // 按需获取预览文本列表
    onRequirePreviews: () => string[] = () => [];

    @State private expanded: boolean = false;
    @State private previews: string[] = [];
    @State private lineKeys: string[] = [];
    private previewScroller: Scroller = new Scroller();

    aboutToAppear(): void {
        this.rebuildLineKeys();
    }

    private onTurnCountChange(): void {
        this.rebuildLineKeys();
    }

    private rebuildLineKeys(): void {
        const keys: string[] = [];
        for (let i: number = 0; i < this.turnCount; i++) {
            keys.push('turn_' + i);
        }
        this.lineKeys = keys;
    }

    // 展开：拉取预览并下一帧滚到当前轮次；收起：直接关闭
    private toggleExpand(): void {
        if (this.expanded) {
            this.expanded = false;
            return;
        }

        this.previews = this.onRequirePreviews();
        this.expanded = true;
        setTimeout(() => {
            this.previewScroller.scrollToIndex(this.activeIndex, false, ScrollAlign.CENTER);
        }, 0);
    }

    private handleJump(index: number): void {
        this.expanded = false;
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
                        this.expanded = false;
                    });
            }

            Row({ space: Space.xs }) {
                if (this.expanded) {
                    this.PreviewList();
                }

                this.LinePanel();
            }
            .alignItems(VerticalAlign.Center);
        }
        .alignContent(Alignment.End)
        .width('100%')
        .height('100%');
    }

    // 横线面板：圆角卡片，内部垂直排列横线
    @Builder
    LinePanel() {
        Column() {
            Scroll() {
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
                .width('100%');
            }
            .width(24)
            .constraintSize({ maxHeight: LINE_HEIGHT * PANEL_MAX_LINES + LINE_GAP * (PANEL_MAX_LINES - 1) })
            .scrollBar(BarState.Off);
        }
        .padding({ top: Space.sm, bottom: Space.sm, left: Space.xs, right: Space.xs })
        .backgroundColor($r('app.color.bg_card'))
        .borderRadius(Radius.md)
        .shadow(Shadow.card)
        .onClick(() => {
            this.toggleExpand();
        });
    }

    // 预览浮层：每轮用户消息内容截断，点击跳转
    @Builder
    PreviewList() {
        Scroll(this.previewScroller) {
            Column({ space: Space.xxs }) {
                ForEach(this.previews, (preview: string, index: number) => {
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
                }, (preview: string, index: number) => index + '_' + preview);
            }
            .width('100%');
        }
        .width(200)
        .constraintSize({ maxHeight: 300 })
        .padding({ top: Space.xs, bottom: Space.xs })
        .backgroundColor($r('app.color.bg_card'))
        .borderRadius(Radius.md)
        .shadow(Shadow.raised)
        .scrollBar(BarState.Off);
    }
}
