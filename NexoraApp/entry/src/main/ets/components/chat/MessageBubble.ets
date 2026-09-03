// MessageBubble.ets - 单条消息的完整呈现
// 用户消息走右侧气泡，助手消息走左侧无气泡流（豆包式）
// 助手消息按 segments 数组原序渲染：Thinking1 → Tool → Thinking2 → Content，保持真实时序

import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';
import { ChatMessage, MessageSegment, ToolCallItem } from '../../common/ChatTypes';
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

    private canShowActions(): boolean {
        return !this.message.streaming && this.message.content.length > 0;
    }

    // 按 callId 在 toolCalls 数组中查找对应的 ToolCallItem
    private findToolCall(callId: string): ToolCallItem | undefined {
        for (let i: number = 0; i < this.message.toolCalls.length; i++) {
            if (this.message.toolCalls[i].callId === callId) {
                return this.message.toolCalls[i];
            }
        }

        return undefined;
    }

    build() {
        Column({ space: Space.xs }) {
            if (this.message.isUser) {
                Row() {
                    Blank();
                    this.UserBubble();
                }
                .width('100%');
            } else {
                // 助手消息：头像独占一行，下方内容区占满宽度，不被头像挤压
                BrandLogo({ diameter: 28, showShadow: false });

                this.AssistantContent();
            }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
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

    // 助手内容：按 segments 数组原序渲染，保持 Thinking → Tool → Thinking2 → Content 时序
    @Builder
    AssistantContent() {
        Column({ space: Space.sm }) {
            ForEach(this.message.segments, (segment: MessageSegment, index: number) => {
                if (segment.type === 'reasoning') {
                    ThinkingBlock({
                        text: segment.text,
                        streaming: this.message.streaming,
                        autoCollapse: !this.message.thinkingExpanded
                    });
                }

                if (segment.type === 'function_call') {
                    if (this.findToolCall(segment.callId ?? '') !== undefined) {
                        ToolCallCard({ item: this.findToolCall(segment.callId ?? '') });
                    }
                }

                if (segment.type === 'content') {
                    MarkdownView({ source: segment.text });
                }

                if (segment.type === 'error') {
                    this.SegmentErrorLine(segment.text);
                }
            }, (segment: MessageSegment, index: number) => segment.type + '_' + index);

            // 流式占位：仅在流式中且无任何内容/工具/思考时显示
            if (this.message.streaming && this.message.content.length === 0 && !this.message.hasToolCalls && !this.message.hasThinking) {
                StreamingDots();
            }

            if (this.message.errorMessage.length > 0) {
                this.TopLevelErrorLine();
            }

            if (this.canShowActions()) {
                this.MessageActions();
            }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    SegmentErrorLine(text: string) {
        Row({ space: Space.xs }) {
            Image($r('app.media.ic_error'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.text_danger'));

            Text(text)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_danger'))
                .layoutWeight(1);
        }
        .width('100%')
        .padding({ left: Space.md, right: Space.md, top: Space.xs, bottom: Space.xs })
        .borderRadius(Radius.md)
        .backgroundColor($r('app.color.bg_sunken'));
    }

    @Builder
    TopLevelErrorLine() {
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
