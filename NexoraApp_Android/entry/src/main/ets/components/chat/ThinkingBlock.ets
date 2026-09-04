// ThinkingBlock.ets - 思考过程折叠块
// 流式进行中显示「正在思考」，输出正文/工具后由 autoCollapse 信号触发自动折叠
// 每个思考段独立管理展开/折叠状态，支持 Thinking1 → Tool → Thinking2 多段按序展示

import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';

@Component
export struct ThinkingBlock {
    @Prop text: string;
    @Prop streaming: boolean = false;
    // autoCollapse 由父组件驱动：当输出正文/工具时变为 true，触发本块自动折叠
    @Prop @Watch('onAutoCollapse') autoCollapse: boolean = false;

    @State private expanded: boolean = true;

    aboutToAppear(): void {
        // 流式中的思考段默认展开，历史消息的思考段默认折叠
        this.expanded = this.streaming;
    }

    // autoCollapse 从 false 变为 true 时自动折叠
    private onAutoCollapse(): void {
        if (this.autoCollapse) {
            this.expanded = false;
        }
    }

    private headerText(): string {
        return this.streaming ? '正在思考…' : '已深度思考';
    }

    private headerTint(): ResourceColor {
        return this.streaming ? $r('app.color.text_brand') : $r('app.color.text_secondary');
    }

    build() {
        Column({ space: Space.sm }) {
            Row({ space: Space.sm }) {
                Image($r('app.media.ic_thinking'))
                    .width(Size.iconSmall)
                    .height(Size.iconSmall)
                    .fillColor(this.headerTint());

                Text(this.headerText())
                    .fontSize(FontSize.small)
                    .fontColor(this.headerTint());

                Blank();

                Image($r('app.media.ic_chevron_down'))
                    .width(14)
                    .height(14)
                    .fillColor($r('app.color.icon_secondary'))
                    .rotate({ angle: this.expanded ? 180 : 0 })
                    .animation({ duration: Motion.durationBase, curve: Motion.spring });
            }
            .width('100%')
            .height(26)
            .onClick(() => {
                this.expanded = !this.expanded;
            });

            if (this.expanded) {
                Text(this.text)
                    .fontSize(FontSize.small)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .width('100%')
                    .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));
            }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ left: Space.md, right: Space.md, top: Space.sm, bottom: Space.sm })
        .borderRadius(Radius.md)
        .backgroundColor($r('app.color.bg_sunken'))
    }
}
