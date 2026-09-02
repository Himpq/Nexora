// MessageBubble.ets - 单条消息的完整呈现
// 用户消息走右侧气泡，助手消息走左侧无气泡流（豆包式），内部按需组合思考块 / 工具卡片 / Markdown

import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';
import { ChatMessage, ToolCallItem } from '../../common/ChatTypes';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { BrandLogo } from '../common/BrandLogo';
import { MarkdownView } from './MarkdownBlock';
import { StreamingDots } from './StreamingDots';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallCard } from './ToolCallCard';

@Component
export struct MessageBubble {
    @ObjectLink message: ChatMessage;
    onRegenerate: (message: ChatMessage) => void = () => {};

    // UI 统一走普通方法而非原型 getter：@ObjectLink 组件 UI 更新路径下 getter 间接取值曾返回 undefined 触发崩溃
    private canShowActions(): boolean {
        return !this.message.streaming && this.message.content.length > 0;
    }

    build() {
        Row({ space: Space.sm }) {
            if (this.message.isUser) {
                Blank();
                this.UserBubble();
            } else {
                BrandLogo({ diameter: 28, showShadow: false });
                this.AssistantContent();
            }
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
        .padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.sm });
    }

    // 用户气泡：右下角收窄模拟气泡尾巴，宽度自适应不超过屏宽 78%
    @Builder
    UserBubble() {
        Text(this.message.content)
            .fontSize(FontSize.body)
            .lineHeight(LineHeight.body)
            .fontColor($r('app.color.text_inverse'))
            .textAlign(TextAlign.Start)
            .padding({ left: Space.md, right: Space.md, top: Space.md, bottom: Space.md })
            .constraintSize({ maxWidth: '78%' })
            .backgroundColor($r('app.color.bubble_user'))
            .borderRadius({
                topLeft: Radius.lg,
                topRight: Radius.lg,
                bottomLeft: Radius.lg,
                bottomRight: Radius.sm
            })
            .copyOption(CopyOptions.LocalDevice);
    }

    @Builder
    AssistantContent() {
        Column({ space: Space.sm }) {
            if (this.message.hasThinking) {
                ThinkingBlock({ message: this.message });
            }

            if (this.message.hasToolCalls) {
                Column({ space: Space.xs }) {
                    ForEach(this.message.toolCalls, (item: ToolCallItem) => {
                        ToolCallCard({ item: item });
                    }, (item: ToolCallItem) => item.callId);
                }
                .width('100%');
            }

            if (this.message.content.length > 0) {
                MarkdownView({ source: this.message.content });
            }

            if (this.message.streaming && this.message.content.length === 0 && !this.message.hasToolCalls) {
                StreamingDots();
            }

            if (this.message.errorMessage.length > 0) {
                this.ErrorLine();
            }

            if (this.canShowActions()) {
                this.MessageActions();
            }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    ErrorLine() {
        Row({ space: Space.xs }) {
            Image($r('app.media.ic_error'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.text_danger'));

            Text(this.message.errorMessage)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_danger'))
                .layoutWeight(1);
        }
        .width('100%')
        .padding({ left: Space.md, right: Space.md, top: Space.xs, bottom: Space.xs })
        .borderRadius(Radius.md)
        .backgroundColor($r('app.color.bg_sunken'));
    }

    // 消息操作条：生成结束后淡入，提供复制与重新生成
    @Builder
    MessageActions() {
        Row({ space: Space.sm }) {
            this.ActionChip('复制', $r('app.media.ic_copy'), () => {
                this.copyContent();
            });

            this.ActionChip('重新生成', $r('app.media.ic_refresh'), () => {
                this.onRegenerate(this.message);
            });
        }
        .width('100%')
        .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));
    }

    @Builder
    ActionChip(label: string, icon: ResourceStr, action: () => void) {
        Row({ space: Space.xs }) {
            Image(icon)
                .width(14)
                .height(14)
                .fillColor($r('app.color.icon_secondary'));

            Text(label)
                .fontSize(FontSize.caption)
                .fontColor($r('app.color.text_secondary'));
        }
        .padding({ left: Space.md, right: Space.md, top: Space.xs, bottom: Space.xs })
        .borderRadius(Radius.full)
        .backgroundColor($r('app.color.bg_sunken'))
        .onClick(action);
    }

    private copyContent(): void {
        const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.message.content);
        pasteboard.getSystemPasteboard().setData(data);
        promptAction.showToast({ message: '已复制回答', duration: 1200 });
    }
}
