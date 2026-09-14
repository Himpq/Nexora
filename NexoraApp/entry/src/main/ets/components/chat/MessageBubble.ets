// MessageBubble.ets - 单条消息的完整呈现
// 用户消息走右侧气泡，助手消息走左侧无气泡流（豆包式）
// 助手消息按 segments 数组原序渲染：Thinking1 → Tool → Thinking2 → Content，保持真实时序

import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';
import { ChatMessage, MessageSegment, ToolCallItem, TokenUsage } from '../../common/ChatTypes';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { QuestionItem } from '../../common/QuestionLocks';
import { BrandLogo } from '../common/BrandLogo';
import { MarkdownView } from './MarkdownBlock';
import { QuestionCard } from './QuestionCard';
import { StreamingDots } from './StreamingDots';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolSegment } from './ToolSegment';
import { UserAttachments } from './UserAttachments';

@Component
export struct MessageBubble {
    @ObjectLink message: ChatMessage;
    conversationId: string = '';
    onRegenerate: () => void = () => {};
    onOpenImage: (url: string) => void = () => {};
    onQuestionAnswer: (item: QuestionItem, answer: string) => void = () => {};
    @State private pressedActionLabel: string = '';

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

    // 按 callId 在 questions 数组中查找对应的 QuestionItem
    private findQuestion(callId: string): QuestionItem | undefined {
        for (let i: number = 0; i < this.message.questions.length; i++) {
            if (this.message.questions[i].callId === callId) {
                return this.message.questions[i];
            }
        }

        return undefined;
    }

    build() {
        Column({ space: Space.xs }) {
            if (this.message.isUser) {
                // 用户消息：气泡（有正文时）+ 附件区（图片缩略图/文件胶囊），同侧右对齐
                Column({ space: Space.xs }) {
                    if (this.message.content.length > 0) {
                        Row() {
                            Blank();
                            this.UserBubble();
                        }
                        .width('100%');
                    }

                    if (this.message.attachments.length > 0) {
                        UserAttachments({
                            attachments: this.message.attachments,
                            onOpenImage: this.onOpenImage
                        });
                    }
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
                        ToolSegment({
                            item: this.findToolCall(segment.callId ?? ''),
                            conversationId: this.conversationId,
                            onOpenImage: this.onOpenImage
                        });
                    }
                }

                if (segment.type === 'question') {
                    if (this.findQuestion(segment.callId ?? '') !== undefined) {
                        QuestionCard({
                            item: this.findQuestion(segment.callId ?? ''),
                            onAnswer: (item: QuestionItem, answer: string) => {
                                this.onQuestionAnswer(item, answer);
                            }
                        });
                    }
                }

                if (segment.type === 'content') {
                    MarkdownView({ source: segment.text });
                }

                if (segment.type === 'error') {
                    this.SegmentErrorLine(segment.text);
                }
            // key 含 text.length：续写时 text 增长 → key 变化 → ForEach 重建子组件。
            // 若 key 不含 text.length，ForEach 复用旧组件实例，MarkdownView 的
            // @Prop @Watch('onSourceChange') 在 ForEach 复用路径下不触发 watch 回调，
            // 导致 @State blocks 不更新 → 流式正文只显示首帧、后续增量全部丢失
            }, (segment: MessageSegment, index: number) => segment.type + '_' + index + '_' + segment.text.length);

            // 流式占位：仅在流式中且无任何内容/工具/思考/问题时显示
            if (this.message.streaming && this.message.content.length === 0 && !this.message.hasToolCalls && !this.message.hasThinking && !this.message.hasQuestions) {
                StreamingDots();
            }

            if (this.message.errorMessage.length > 0) {
                this.TopLevelErrorLine();
            }

            if (this.message.usage !== null) {
                this.TokenUsageBar();
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

    // Token 用量条：模型名称 + I/O 与缓存命中，仅在 usage 有数据时出现
    @Builder
    TokenUsageBar() {
        Column({ space: Space.xxs }) {
            if (this.message.modelName.length > 0) {
                Text(this.message.modelName)
                    .fontSize(FontSize.micro)
                    .fontColor($r('app.color.text_tertiary'));
            }

            Text(this.buildUsageText())
                .fontSize(FontSize.micro)
                .fontColor($r('app.color.text_tertiary'));
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ left: Space.xs, right: Space.xs, top: Space.xxs, bottom: Space.xxs });
    }

    // 用量文案：I/O: 输入/输出 + 可选 E/C: 有效/缓存 (命中率%)
    private buildUsageText(): string {
        const usage: TokenUsage | null = this.message.usage;

        if (usage === null) {
            return '';
        }

        let text: string = 'I/O: ' + usage.inputTokens + '/' + usage.outputTokens;

        if (usage.rawInputTokens > 0 || usage.cachedInputTokens > 0) {
            const effective: number = Math.max(0, usage.rawInputTokens - usage.cachedInputTokens);
            const pct: number = usage.rawInputTokens > 0
                ? Math.min(100, Math.round((usage.cachedInputTokens / usage.rawInputTokens) * 10000) / 100)
                : 0;
            text += '  E/C: ' + effective + '/' + usage.cachedInputTokens + ' (' + pct.toFixed(2) + '%)';
        }

        return text;
    }

    // 消息操作条：生成结束后淡入，提供复制与重新生成
    @Builder
    MessageActions() {
        Row({ space: Space.sm }) {
            this.ActionChip('复制', $r('app.media.ic_copy'), () => {
                this.copyContent();
            });

            this.ActionChip('重新生成', $r('app.media.ic_refresh'), () => {
                this.onRegenerate();
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
        .backgroundColor(this.pressedActionLabel === label
            ? $r('app.color.bg_pressed')
            : $r('app.color.bg_sunken'))
        .animation({ duration: Motion.durationPress, curve: Motion.press })
        .onTouch((event: TouchEvent) => {
            if (event.type === TouchType.Down) {
                this.pressedActionLabel = label;
            }

            if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                this.pressedActionLabel = '';
            }
        })
        .onClick(action);
    }

    private copyContent(): void {
        const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.message.content);
        pasteboard.getSystemPasteboard().setData(data);
        promptAction.showToast({ message: '已复制回答', duration: 1200 });
    }
}
