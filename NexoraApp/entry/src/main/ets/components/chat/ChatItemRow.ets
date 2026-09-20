// ChatItemRow.ets - 块级渲染单元的行渲染器
//
// 一个单元只画一样东西：用户气泡、助手头像、思考块、工具卡、选择题卡、
// 一个 markdown 块、错误行、流式占位、用量条、操作条。
// 这样每一行的构建成本与它自身大小成正比，滚动时不再需要为「一条四屏高的回答」
// 反复布局绘制整棵子树。
//
// 行内只观察 @ObjectLink item：流式增量由数据源原地改写单元字段触发单行重渲染。
// 行不使用 @Reusable：不同 Markdown 块的内部 Text / Span 树不能跨列表键复用，
// 否则行换绑时可能出现「数据已换、屏幕仍显示上一行某一段」的串台。

import { hilog } from '@kit.PerformanceAnalysisKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';
import { ChatMessage, TokenUsage } from '../../common/ChatTypes';
import { ChatItemKind, ChatRenderItem } from '../../common/ChatRenderItem';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { QuestionItem } from '../../common/QuestionLocks';
import { BrandLogo } from '../common/BrandLogo';
import { MarkdownBlockView } from './MarkdownBlock';
import { QuestionCard } from './QuestionCard';
import { StreamingDots } from './StreamingDots';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolGallerySegment } from './ToolGallerySegment';
import { ToolSegment } from './ToolSegment';
import { UserAttachments } from './UserAttachments';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraRow';
// 行最小高度（vp）：引擎对未测量行按已测均值（实测 34~44vp）估算，矮行首次测量时
// 会产生 |行高 − 均值| 的可见位移。18vp 的用量条 / 分隔线在带外（带 = 均值 ± 24vp），
// 抬到 30vp 后落回带内。高行不受此约束影响
const ROW_MIN_HEIGHT: number = 30;

@Component
export struct ChatItemRow {
    @ObjectLink item: ChatRenderItem;
    conversationId: string = '';
    onRegenerate: (message: ChatMessage) => void = () => {};
    onOpenImage: (url: string) => void = () => {};
    onQuestionAnswer: (item: QuestionItem, answer: string) => void = () => {};
    @State private pressedActionLabel: string = '';
    build() {
        Column() {
            if (this.item.kind === ChatItemKind.USER_MESSAGE) {
                this.UserMessage();
            } else if (this.item.kind === ChatItemKind.ASSISTANT_AVATAR) {
                BrandLogo({ diameter: 28, showShadow: false });
            } else if (this.item.kind === ChatItemKind.REASONING) {
                ThinkingBlock({
                    text: this.item.reasoningText,
                    streaming: this.item.reasoningStreaming,
                    autoCollapse: !this.item.reasoningExpanded,
                    rowIdentity: this.item.expansionIdentity()
                });
            } else if (this.item.kind === ChatItemKind.TOOL_CALL) {
                if (this.item.toolCall !== null) {
                    ToolSegment({
                        item: this.item.toolCall,
                        conversationId: this.conversationId,
                        onOpenImage: this.onOpenImage
                    });
                }
            } else if (this.item.kind === ChatItemKind.TOOL_GALLERY) {
                if (this.item.toolCall !== null) {
                    ToolGallerySegment({
                        item: this.item.toolCall,
                        onOpenImage: this.onOpenImage
                    });
                }
            } else if (this.item.kind === ChatItemKind.QUESTION) {
                if (this.item.question !== null) {
                    QuestionCard({
                        item: this.item.question,
                        rowIdentity: this.item.key(),
                        onAnswer: (target: QuestionItem, answer: string) => {
                            this.onQuestionAnswer(target, answer);
                        }
                    });
                }
            } else if (this.item.kind === ChatItemKind.CONTENT_BLOCK) {
                if (this.item.blockHolder !== null) {
                    MarkdownBlockView({
                        holder: this.item.blockHolder
                    });
                }
            } else if (this.item.kind === ChatItemKind.SEGMENT_ERROR) {
                this.ErrorLine(this.item.text);
            } else if (this.item.kind === ChatItemKind.STREAMING_DOTS) {
                StreamingDots();
            } else if (this.item.kind === ChatItemKind.ERROR_LINE) {
                this.ErrorLine(this.item.text);
            } else if (this.item.kind === ChatItemKind.USAGE) {
                this.UsageBar();
            } else if (this.item.kind === ChatItemKind.ACTIONS) {
                this.ActionBar();
            }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ left: Space.lg, right: Space.lg })
        .constraintSize({ minHeight: ROW_MIN_HEIGHT })
        // 上下留白：消息之间只由首个单元出手（每行都留白会把间距叠成两倍）；
        // markdown 块之间的间距原本由 MarkdownView 的 Column space 提供，
        // 拆成独立行后由块自身补上，维持段落间原有的呼吸感
        .margin({ top: this.topMargin(), bottom: this.bottomMargin() })
        // 轮次跳转高亮：边框宽度恒为 1vp、只切换颜色 ——
        // 宽度参与布局，0/1 来回切换会让整行重新测量并推移列表
        .backgroundColor(this.item.highlighted ? $r('app.color.brand_soft') : Color.Transparent)
        .border({
            width: 1,
            color: this.item.highlighted ? $r('app.color.brand_primary') : Color.Transparent
        })
        // 只记录真正的尺寸变化；滚动引起的位置变化不会触发 onSizeChange。
        // 该日志用于把 List 注入的异常 offset 对齐到具体渲染单元，不参与任何布局修正。
        .onSizeChange((oldValue: SizeOptions, newValue: SizeOptions) => {
            const oldHeight: number = oldValue.height as number;
            const newHeight: number = newValue.height as number;

            if (Math.abs(newHeight - oldHeight) >= 1) {
                hilog.info(DOMAIN, TAG,
                    '[row-size] key=%{public}s kind=%{public}d old=%{public}d new=%{public}d fp=%{public}s',
                    this.item.key(), this.item.kind, Math.round(oldHeight), Math.round(newHeight), this.item.fingerprint());
            }
        })
        // 行高由列表一次测量完成后保持稳定，不在滚动路径挂载逐行 onAreaChange 回调。
    }

    private topMargin(): number {
        // List 的 space 归零后，消息之间的间距由首行自己给足：
        // 原先「列表间距 4 + 首行留白 8」的 12vp 由这里一次性给出
        return this.item.firstOfMessage ? Space.md : 0;
    }

    private bottomMargin(): number {
        // 被切开过的块，接缝间距由展开器显式给出（列表片 4vp、表格片 0）：
        // 接缝必须与该块内部原本的间距一致，用默认值会把一张表或一张列表切成几截
        if (this.item.gapBelow >= 0) {
            return this.item.gapBelow;
        }

        // List 的 space 为 0，行间间距全部由行自己给出：
        // 内容块之间 Space.sm(8vp)，其余相邻行 Space.xs(4vp) —— 与拆分前的实际间距等效
        return this.item.kind === ChatItemKind.CONTENT_BLOCK ? Space.sm : Space.xs;
    }

    // 用户消息：气泡（有正文时）+ 附件区（图片缩略图 / 文件胶囊），同侧右对齐。
    // 长提问被展开器按行切片（userSliceTotal > 1），每个切片自成一行的整幅气泡；
    // 切片只对无附件的提问生效，因此切片行不渲染附件区
    @Builder
    UserMessage() {
        Column({ space: Space.xs }) {
            if (this.item.userSliceTotal > 1) {
                this.UserBubbleSlice();
            } else if (this.item.message.content.length > 0) {
                Row() {
                    Blank();
                    this.UserBubble();
                }
                .width('100%');
            }

            if (this.item.message.attachments.length > 0) {
                UserAttachments({
                    attachments: this.item.message.attachments,
                    onOpenImage: this.onOpenImage
                });
            }
        }
        .width('100%');
    }

    // 长提问的气泡切片：各片固定 78% 宽（与自适应气泡换行后的最大宽度一致），
    // 圆角与上下 padding 按片位补、接缝 gap 为 0（见 ChatItemBuilder），拼起来与整条气泡视觉一致
    @Builder
    UserBubbleSlice() {
        Row() {
            Blank();

            Text(this.item.text)
                .fontSize(FontSize.body)
                .lineHeight(LineHeight.body)
                .fontColor($r('app.color.text_inverse'))
                .textAlign(TextAlign.Start)
                .width('78%')
                .padding({
                    left: Space.md,
                    right: Space.md,
                    top: this.item.order === 0 ? Space.md : 0,
                    bottom: this.item.order === this.item.userSliceTotal - 1 ? Space.md : 0
                })
                .backgroundColor($r('app.color.bubble_user'))
                .borderRadius({
                    topLeft: this.item.order === 0 ? Radius.lg : 0,
                    topRight: this.item.order === 0 ? Radius.lg : 0,
                    bottomLeft: this.item.order === this.item.userSliceTotal - 1 ? Radius.lg : 0,
                    bottomRight: this.item.order === this.item.userSliceTotal - 1 ? Radius.sm : 0
                })
                .copyOption(CopyOptions.LocalDevice);
        }
        .width('100%');
    }

    // 用户气泡：右下角收窄模拟气泡尾巴，宽度自适应不超过屏宽 78%
    @Builder
    UserBubble() {
        Text(this.item.message.content)
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
    ErrorLine(text: string) {
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

    // Token 用量条：模型名称 + I/O 与缓存命中，仅在 usage 有数据时出现
    @Builder
    UsageBar() {
        Column({ space: Space.xxs }) {
            if (this.item.modelName.length > 0) {
                Text(this.item.modelName)
                    .fontSize(FontSize.micro)
                    .fontColor($r('app.color.text_tertiary'));
            }

            Text(this.usageText())
                .fontSize(FontSize.micro)
                .fontColor($r('app.color.text_tertiary'));
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ left: Space.xs, right: Space.xs, top: Space.xxs, bottom: Space.xxs });
    }

    // 用量文案：I/O: 输入/输出 + 可选 E/C: 有效/缓存 (命中率%)
    private usageText(): string {
        const usage: TokenUsage | null = this.item.usage;

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

    // 消息操作条：生成结束后出现，提供复制与重新生成
    @Builder
    ActionBar() {
        Row({ space: Space.sm }) {
            this.ActionChip('复制', $r('app.media.ic_copy'), () => {
                this.copyContent();
            });

            this.ActionChip('重新生成', $r('app.media.ic_refresh'), () => {
                this.onRegenerate(this.item.message);
            });
        }
        .width('100%');
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
        const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN,
            this.item.message.content);
        pasteboard.getSystemPasteboard().setData(data);
        promptAction.showToast({ message: '已复制回答', duration: 1200 });
    }
}
