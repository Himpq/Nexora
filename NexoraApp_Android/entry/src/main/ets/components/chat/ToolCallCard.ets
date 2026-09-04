// ToolCallCard.ets - 工具调用卡片
// 一条工具调用从 running 到 done/error 的状态都收敛在这里，点击展开入参与返回摘要

import { ToolCallItem } from '../../common/ChatTypes';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';

@Component
export struct ToolCallCard {
    @ObjectLink item: ToolCallItem;

    // UI 统一走普通方法而非原型 getter：@ObjectLink 组件 UI 更新路径下 getter 间接取值曾返回 undefined 触发崩溃
    private statusColor(): ResourceColor {
        if (this.item.status === 'error') {
            return $r('app.color.text_danger');
        }

        return this.item.status === 'running' ? $r('app.color.text_brand') : $r('app.color.text_success');
    }

    private statusText(): string {
        if (this.item.status === 'error') {
            return '调用失败';
        }

        return this.item.status === 'running' ? '执行中' : '已完成';
    }

    build() {
        Column({ space: Space.sm }) {
            Row({ space: Space.sm }) {
                Image($r('app.media.ic_wrench'))
                    .width(Size.iconSmall)
                    .height(Size.iconSmall)
                    .fillColor(this.statusColor());

                Text(this.item.displayName)
                    .fontSize(FontSize.small)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'));

                Text(this.statusText())
                    .fontSize(FontSize.micro)
                    .fontColor(this.statusColor());

                Blank();

                if (this.item.status === 'running') {
                    LoadingProgress()
                        .width(14)
                        .height(14)
                        .color(this.statusColor());
                } else {
                    Image($r('app.media.ic_chevron_down'))
                        .width(14)
                        .height(14)
                        .fillColor($r('app.color.icon_secondary'))
                        .rotate({ angle: this.item.expanded ? 180 : 0 })
                        .animation({ duration: Motion.durationBase, curve: Motion.spring });
                }
            }
            .width('100%')
            .onClick(() => {
                this.item.toggleExpanded();
            });

            if (this.item.expanded) {
                Column({ space: Space.xs }) {
                    if (this.item.argumentsText.length > 0) {
                        this.DetailLine('入参', this.item.argumentsText);
                    }

                    if (this.item.resultText.length > 0) {
                        this.DetailLine('结果', this.item.resultText);
                    }
                }
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

    @Builder
    DetailLine(label: string, value: string) {
        Column({ space: Space.xxs }) {
            Text(label)
                .fontSize(FontSize.micro)
                .fontColor($r('app.color.text_tertiary'));

            Text(value)
                .fontSize(FontSize.small)
                .lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_secondary'))
                .fontFamily('monospace')
                .width('100%')
                .maxLines(6)
                .textOverflow({ overflow: TextOverflow.Ellipsis });
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }
}
