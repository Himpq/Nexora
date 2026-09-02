// ThinkingBlock.ets - 思考过程折叠块
// 展示模型的推理链路：流式进行中显示「正在思考」，结束后折叠收纳，避免抢占正文注意力

import { ChatMessage } from '../../common/ChatTypes';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';

@Component
export struct ThinkingBlock {
    @ObjectLink message: ChatMessage;

    // UI 统一走普通方法而非原型 getter：@ObjectLink 组件 UI 更新路径下 getter 间接取值曾返回 undefined 触发崩溃
    private running(): boolean {
        return this.message.streaming;
    }

    private headerText(): string {
        return this.running() ? '正在思考…' : '已深度思考';
    }

    private headerTint(): ResourceColor {
        return this.running() ? $r('app.color.text_brand') : $r('app.color.text_secondary');
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
                    .rotate({ angle: this.message.thinkingExpanded ? 180 : 0 })
                    .animation({ duration: Motion.durationBase, curve: Motion.spring });
            }
            .width('100%')
            .height(26)
            .onClick(() => {
                this.message.thinkingExpanded = !this.message.thinkingExpanded;
            });

            if (this.message.thinkingExpanded) {
                Text(this.message.reasoning)
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
