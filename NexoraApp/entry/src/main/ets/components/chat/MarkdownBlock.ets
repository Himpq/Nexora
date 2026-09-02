// MarkdownBlock.ets - Markdown 渲染组件
// 只做「结构 -> 组件」的翻译，解析逻辑全部在 common/MarkdownParser.ets
// 关键约束：同一个 Text 内所有 Span 必须同字号，避免行盒高度不一致造成的文本偏移

import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';
import { FontSize, LineHeight, Radius, Space } from '../../common/DesignToken';
import { InlinePiece, ListItem, MarkdownBlock as MdBlock, MarkdownParser } from '../../common/MarkdownParser';

const MONO_FONT: string = 'monospace';

// 标题字号梯度：等级越大越弱
const HEADING_SIZES: number[] = [FontSize.display, FontSize.titleLarge, FontSize.title, FontSize.bodyLarge, FontSize.body, FontSize.body];

// 行内文本的块级差异样式：@Builder 调用返回 void，不允许链式挂属性，
// 因此标题 / 引用 / 列表的差异一律作为参数传入渲染内核，字段缺省时走正文默认值
interface InlineStyle {
    color?: ResourceColor;
    bold?: boolean;
    fill?: boolean;
    marginTop?: number;
    marginBottom?: number;
}

@Component
export struct MarkdownView {
    @Prop @Watch('onSourceChange') source: string;
    // 行内代码与链接的强调色，助手消息用品牌色，用户气泡内用反色
    @Prop accentColor: ResourceColor = $r('app.color.text_brand');
    @Prop codeBackgroundColor: ResourceColor = $r('app.color.code_bg');
    @Prop codeTextColor: ResourceColor = $r('app.color.code_text');
    @State private blocks: MdBlock[] = [];

    aboutToAppear(): void {
        this.blocks = MarkdownParser.parse(this.source);
    }

    onSourceChange(): void {
        this.blocks = MarkdownParser.parse(this.source);
    }

    build() {
        Column({ space: Space.md }) {
            ForEach(this.blocks, (block: MdBlock, index: number) => {
                this.renderBlock(block);
            }, (block: MdBlock, index: number) => index + '_' + block.type + '_' + block.inline.length);
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
    }

    @Builder
    renderBlock(block: MdBlock) {
        if (block.type === 'heading') {
            this.HeadingBlock(block);
        } else if (block.type === 'code') {
            this.CodeBlock(block);
        } else if (block.type === 'quote') {
            this.QuoteBlock(block);
        } else if (block.type === 'list') {
            this.ListBlock(block);
        } else if (block.type === 'divider') {
            Divider()
                .strokeWidth(1)
                .color($r('app.color.divider'))
                .width('100%')
                .margin({ top: Space.xs, bottom: Space.xs });
        } else {
            this.InlineText(block.inline, FontSize.body, LineHeight.body, {});
        }
    }

    // 标题：按等级取字号，加粗并预留上下留白
    @Builder
    HeadingBlock(block: MdBlock) {
        this.InlineText(block.inline, HEADING_SIZES[block.level - 1], LineHeight.title, {
            bold: true,
            marginTop: block.level <= 2 ? Space.sm : Space.xs,
            marginBottom: Space.xxs
        });
    }

    // 代码块：语言标签 + 复制按钮，正文横向滚动，保证长行不折行
    @Builder
    CodeBlock(block: MdBlock) {
        Column({ space: 0 }) {
            Row() {
                Text(block.language.length > 0 ? block.language : 'code')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .fontFamily(MONO_FONT);

                Blank();

                Text('复制')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_secondary'))
                    .padding({ left: Space.sm, right: Space.sm, top: Space.xxs, bottom: Space.xxs })
                    .borderRadius(Radius.xs)
                    .onClick(() => {
                        this.copyToClipboard(block.codeText);
                    });
            }
            .width('100%')
            .padding({ left: Space.md, right: Space.sm, top: Space.sm, bottom: Space.xs });

            Scroll() {
                Text(block.codeText)
                    .fontSize(FontSize.small)
                    .fontFamily(MONO_FONT)
                    .lineHeight(LineHeight.bodyCode)
                    .fontColor($r('app.color.text_primary'))
                    .width('100%');
            }
            .scrollable(ScrollDirection.Horizontal)
            .scrollBar(BarState.Off)
            .width('100%')
            .padding({ left: Space.md, right: Space.md, bottom: Space.md });
        }
        .width('100%')
        .backgroundColor(this.codeBackgroundColor)
        .borderRadius(Radius.md)
    }

    // 引用块：左侧竖条 + 弱化正文
    @Builder
    QuoteBlock(block: MdBlock) {
        Row({ space: Space.md }) {
            Column()
                .width(3)
                .height('100%')
                .backgroundColor($r('app.color.quote_bar'))
                .borderRadius(Radius.full);

            this.InlineText(block.inline, FontSize.body, LineHeight.body, {
                color: $r('app.color.text_secondary'),
                fill: true
            });
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
        .padding({ left: Space.sm, right: Space.sm, top: Space.xs, bottom: Space.xs })
    }

    // 列表：标记列固定宽度，正文自适应，保证多行条目缩进对齐
    @Builder
    ListBlock(block: MdBlock) {
        Column({ space: Space.xs }) {
            ForEach(block.items, (item: ListItem, index: number) => {
                Row({ space: Space.sm }) {
                    Text(item.marker.length > 0 ? item.marker : '•')
                        .fontSize(FontSize.body)
                        .lineHeight(LineHeight.body)
                        .fontColor($r('app.color.text_tertiary'))
                        .width(18)
                        .textAlign(TextAlign.End);

                    this.InlineText(item.inline, FontSize.body, LineHeight.body, { fill: true });
                }
                .width('100%')
                .alignItems(VerticalAlign.Top);
            }, (item: ListItem, index: number) => index + '_' + item.marker + '_' + item.inline.length);
        }
        .width('100%')
    }

    // 行内文本：整段一个 Text，Span 只改变颜色 / 字重 / 字体，绝不改字号
    // 块级差异样式以 style 参数传入：加粗、换色、占满剩余宽度、上下留白
    @Builder
    InlineText(pieces: InlinePiece[], fontSize: number, lineHeight: number, style: InlineStyle) {
        Text() {
            ForEach(pieces, (piece: InlinePiece) => {
                if (piece.code) {
                    ContainerSpan() {
                        Span(piece.text)
                            .fontSize(fontSize)
                            .fontFamily(MONO_FONT)
                            .fontColor(this.codeTextColor);
                    }
                    .textBackgroundStyle({ color: this.codeBackgroundColor, radius: Radius.xs });
                } else {
                    Span(this.renderLinkPrefix(piece) + piece.text)
                        .fontSize(fontSize)
                        .fontWeight(piece.bold ? FontWeight.Bold : FontWeight.Regular)
                        .fontStyle(piece.italic ? FontStyle.Italic : FontStyle.Normal)
                        .fontColor(this.spanColor(piece))
                        .decoration(piece.href.length > 0
                            ? { type: TextDecorationType.Underline, color: this.accentColor }
                            : { type: TextDecorationType.None });
                }
            }, (piece: InlinePiece, index: number) => index + '_' + piece.text);
        }
        .fontSize(fontSize)
        .lineHeight(lineHeight)
        .width('100%')
        .wordBreak(WordBreak.BREAK_WORD)
        .textAlign(TextAlign.Start)
        .fontColor(style.color === undefined ? $r('app.color.text_primary') : style.color)
        .fontWeight(style.bold === true ? FontWeight.Bold : FontWeight.Regular)
        .layoutWeight(style.fill === true ? 1 : 0)
        .margin({
            top: style.marginTop === undefined ? 0 : style.marginTop,
            bottom: style.marginBottom === undefined ? 0 : style.marginBottom
        });
    }

    // 链接前缀：渲染层没有行内图片能力，用 ⟩ 提示可跳转
    private renderLinkPrefix(piece: InlinePiece): string {
        return piece.href.length > 0 ? '⟩ ' : '';
    }

    private spanColor(piece: InlinePiece): ResourceColor {
        return piece.href.length > 0 ? this.accentColor : $r('app.color.text_primary');
    }

    private copyToClipboard(text: string): void {
        const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
        pasteboard.getSystemPasteboard().setData(data);
        promptAction.showToast({ message: '代码已复制', duration: 1200 });
    }
}
