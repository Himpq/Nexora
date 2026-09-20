// MarkdownBlock.ets - 单个 Markdown 块的渲染组件
// 只做「结构 -> 组件」的翻译，解析逻辑全部在 common/MarkdownParser.ets
// 关键约束：同一个 Text 内所有 Span 必须同字号，避免行盒高度不一致造成的文本偏移
//
// 只渲染一个块：列表已按 Markdown AST 把消息拆成块级单元（见 common/ChatItemBuilder.ets），
// 每个块自己就是一个列表行，因此这里不再需要遍历整段文本，也不需要一次性渲染上限。

import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';
import { FontSize, LineHeight, Radius, Space } from '../../common/DesignToken';
import { InlinePiece, ListItem, MarkdownBlock as MdBlock, MarkdownParser, TableData } from '../../common/MarkdownParser';
import { MarkdownBlockHolder } from '../../common/ChatRenderItem';
import { TableScrollSync } from '../../common/TableScrollSync';
const MONO_FONT: string = 'monospace';

// @Builder 按引用传参的载体：形参必须写成 $$（ArkUI 约定），调用处传对象字面量，
// 这样块被替换时 @Builder 会重新求值。写成普通参数（按值）则参数变化不刷新 UI ——
// 行复用后就会一直画着复用前的那个块
interface BlockArg {
    block: MdBlock;
}

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
    align?: TextAlign;
    paddingLeft?: number;
    paddingRight?: number;
}

// 整段 Markdown 渲染：把源文本解析成块后用块视图逐个渲染。
// 聊天列表不用它（那里每个块自己就是一行），知识库编辑器的预览区用它
@Component
export struct MarkdownView {
    @Prop @Watch('onSourceChange') source: string;
    @State private holders: MarkdownBlockHolder[] = [];

    aboutToAppear(): void {
        this.rebuild();
    }

    onSourceChange(): void {
        this.rebuild();
    }

    private rebuild(): void {
        const blocks: MdBlock[] = MarkdownParser.parse(this.source);
        const holders: MarkdownBlockHolder[] = [];

        for (let i: number = 0; i < blocks.length; i++) {
            holders.push(new MarkdownBlockHolder(blocks[i]));
        }

        this.holders = holders;
    }

    build() {
        Column({ space: Space.md }) {
            ForEach(this.holders, (holder: MarkdownBlockHolder) => {
                MarkdownBlockView({ holder: holder });
            }, (holder: MarkdownBlockHolder, index: number) => index.toString());
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }
}

@Component
export struct MarkdownBlockView {
    // 块持有者是 @Observed：流式期间块被替换时只有这一行重渲染
    @ObjectLink holder: MarkdownBlockHolder;
    // 切片块（表格 / 代码块）的横向滚动区：切片后每片各有自己的 Scroll
    private sliceScroller: Scroller = new Scroller();
    // 该块各片共用的横向偏移（懒创建，见 sliceSync）
    private sharedSliceSync: TableScrollSync | null = null;

    // 只在分片节点挂载时恢复共享横向偏移。不能把对齐绑定到 onAreaChange：
    // 该回调还会因外层聊天 List 的纵向滚动而触发，进而让每一帧都检查甚至执行横向 scrollTo。
    aboutToAppear(): void {
        if (this.holder.sliceSyncKey.length > 0) {
            this.sliceSync().align(this.sliceScroller);
        }
    }

    aboutToDisappear(): void {
        if (this.sharedSliceSync !== null) {
            this.sharedSliceSync.unregister(this.sliceScroller);
        }
    }

    // 同一块（表格 / 代码块）各片共用的横向偏移。
    // 块被切成多片后横拖只会落在其中一片上，共享偏移才能让整块一起移动；
    // 整块就是一个单元时（知识库预览）用本组件自己的实例，行为与拆分前一致
    private sliceSync(): TableScrollSync {
        if (this.sharedSliceSync === null) {
            this.sharedSliceSync = this.holder.sliceSyncKey.length > 0
                ? TableScrollSync.forKey(this.holder.sliceSyncKey)
                : new TableScrollSync();
        }

        return this.sharedSliceSync;
    }

    build() {
        Column() {
            this.renderBlock({ block: this.holder.block });
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    renderBlock($$: BlockArg) {
        if ($$.block.type === 'heading') {
            this.HeadingBlock($$.block);
        } else if ($$.block.type === 'code') {
            this.CodeBlock($$.block);
        } else if ($$.block.type === 'quote') {
            this.QuoteBlock($$.block);
        } else if ($$.block.type === 'list') {
            this.ListBlock($$.block);
        } else if ($$.block.type === 'divider') {
            // 上下留白取 Space.sm 而非 Space.xs：分隔线整行只有 10vp，是行高分布里最矮的一端。
            // 引擎对未测量行按已测均值（约 40vp）估算，10vp 的行首次测量时会稳定产生约 30vp 的
            // 可见位移（实测 18:52 会话里 9 次负向跳变全部来自分隔线）。
            // 留白取 8vp 后整行约 17vp，偏差回到 24vp 阈值以内
            Divider()
                .strokeWidth(1)
                .color($r('app.color.divider'))
                .width('100%')
                .margin({ top: Space.sm, bottom: Space.sm });
        } else if ($$.block.type === 'table') {
            this.TableBlock($$.block);
        } else {
            this.InlineText($$.block.inline, FontSize.body, LineHeight.body, {});
        }
    }

    // 标题：按等级取字号，加粗并预留上下留白
    @Builder
    HeadingBlock(block: MdBlock) {
        // 长标题会被切成多片（见 ChatItemBuilder.pushTextSlices）：
        // 上下留白各只出手一次，中间的片留白归零 —— 片与片紧贴，行距与片内一致
        this.InlineText(block.inline, HEADING_SIZES[block.level - 1], LineHeight.title, {
            bold: true,
            marginTop: block.textSliceFirst === false ? 0 : (block.level <= 2 ? Space.sm : Space.xs),
            marginBottom: block.textSliceLast === false ? 0 : Space.xxs
        });
    }

    // 代码块：语言标签 + 复制按钮（只挂在首片），正文横向滚动，保证长行不折行。
    // 长代码块被展开器按源码行切成多片（见 ChatItemBuilder.pushCodeSlices）：
    // 各片之间无间隙，语言栏只在首片、底 padding 只在末片、圆角按片位补，
    // 拼起来与拆分前视觉一致；横拖任意一片都把偏移广播给同一代码块的其余片
    @Builder
    CodeBlock(block: MdBlock) {
        Column({ space: 0 }) {
            if (this.codeSliceFirst(block)) {
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
                            this.copyToClipboard(block.codeFullText ?? block.codeText);
                        });
                }
                .width('100%')
                .padding({ left: Space.md, right: Space.sm, top: Space.sm, bottom: Space.xs });
            }

            Scroll(this.sliceScroller) {
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
            .padding({ left: Space.md, right: Space.md, bottom: this.codeSliceLast(block) ? Space.md : 0 })
            .onDidScroll((xOffset: number) => {
                this.sliceSync().onRowScroll(this.sliceScroller, xOffset);
            });
        }
        .width('100%')
        .backgroundColor($r('app.color.code_bg'))
        .borderRadius(this.codeRadius(block))
    }

    // 代码块分片位置：未设标记表示整块就是一个单元（既是首片也是末片）
    private codeSliceFirst(block: MdBlock): boolean {
        return block.codeSliceFirst !== false;
    }

    private codeSliceLast(block: MdBlock): boolean {
        return block.codeSliceLast !== false;
    }

    // 圆角按片位补：首片画上角、末片画下角、中间不画，各片拼起来仍是完整圆角
    private codeRadius(block: MdBlock): BorderRadiuses {
        const first: boolean = this.codeSliceFirst(block);
        const last: boolean = this.codeSliceLast(block);

        return {
            topLeft: first ? Radius.md : 0,
            topRight: first ? Radius.md : 0,
            bottomLeft: last ? Radius.md : 0,
            bottomRight: last ? Radius.md : 0
        };
    }

    // 引用块：左侧竖条（用左边框实现，避免 height('100%') 循环依赖导致极高） + 弱化正文
    @Builder
    QuoteBlock(block: MdBlock) {
        Column() {
            this.InlineText(block.inline, FontSize.body, LineHeight.body, {
                color: $r('app.color.text_secondary')
            });
        }
        .width('100%')
        .borderWidth({ left: 3 })
        .borderColor({ left: $r('app.color.quote_bar') })
        .padding({ left: Space.sm, right: Space.sm, top: Space.xs, bottom: Space.xs });
    }

    // 列表：标记列固定宽度，正文自适应，保证多行条目缩进对齐
    @Builder
    ListBlock(block: MdBlock) {
        Column({ space: Space.xs }) {
            ForEach(block.items, (item: ListItem, index: number) => {
                Row({ space: Space.sm }) {
                    Text(item.continuation === true ? '' : (item.marker.length > 0 ? item.marker : '•'))
                        .fontSize(FontSize.body)
                        .lineHeight(LineHeight.body)
                        .fontColor($r('app.color.text_tertiary'))
                        .width(18)
                        .textAlign(TextAlign.End);

                    this.InlineText(item.inline, FontSize.body, LineHeight.body, { fill: true });
                }
                .width('100%')
                .alignItems(VerticalAlign.Top);
                // 键必须含内容：行复用后 ForEach 会用旧键匹配节点，
                // 只带 index + marker 的话「位置：山梨县…」和「位置：东京都港区…」键相同，
                // 节点被直接复用 -> 画的是上一块列表里的条目
            }, (item: ListItem, index: number) => this.listItemKey(item, index));
        }
        .width('100%')
    }

    // 表格：外层横向滚动避免列多挤压，表头分层底色 + 加粗，数据行等宽列，单元格支持行内样式
    @Builder
    TableBlock(block: MdBlock) {
        if (block.table !== null) {
            this.TableContent(block.table);
        }
    }

    @Builder
    TableContent(table: TableData) {
        Scroll(this.sliceScroller) {
            Column() {
                // 表头只画在首片：表格被切开后表头重复出现会误导阅读
                if (this.tableSliceFirst(table)) {
                    Row() {
                        ForEach(table.headers, (cell: InlinePiece[], index: number) => {
                            this.InlineText(cell, FontSize.body, LineHeight.body, {
                                bold: true,
                                fill: true,
                                align: this.tableAlign(table.aligns, index),
                                paddingLeft: Space.sm,
                                paddingRight: Space.sm
                            });
                    }, (cell: InlinePiece[], index: number) => this.tableCellKey('h', index));
                    }
                    .width('100%')
                    .backgroundColor($r('app.color.bg_sunken'))
                    .padding({ top: Space.sm, bottom: Space.sm })
                    .borderWidth({ bottom: 1 })
                    .borderColor({ bottom: $r('app.color.border_strong') });
                }

                ForEach(table.rows, (row: InlinePiece[][], rowIndex: number) => {
                    Row() {
                        ForEach(row, (cell: InlinePiece[], colIndex: number) => {
                            this.InlineText(cell, FontSize.body, LineHeight.body, {
                                fill: true,
                                align: this.tableAlign(table.aligns, colIndex),
                                paddingLeft: Space.sm,
                                paddingRight: Space.sm
                            });
                        }, (cell: InlinePiece[], colIndex: number) => this.tableCellKey('c', colIndex));
                    }
                    .width('100%')
                    .padding({ top: Space.xs, bottom: Space.xs })
                    .borderWidth({ bottom: 0.5 })
                    .borderColor({ bottom: $r('app.color.divider') });
                }, (row: InlinePiece[][], rowIndex: number) => this.tableRowKey(rowIndex));
            }
            .width('100%')
            .constraintSize({ minWidth: this.tableMinWidth(this.tableColCount(table)) })
            // 圆角与外框按分片位置补：首片画上边与左右、末片画下边与左右、中间只画左右，
            // 于是多片拼起来在视觉上仍是一张完整的表（各片之间无间隙，见 gapBelow 的取值）
            .borderRadius(this.tableRadius(table))
            .backgroundColor($r('app.color.bg_card'))
            .borderWidth(this.tableBorderWidth(table))
            .borderColor($r('app.color.border'))
            .clip(true);
        }
        .scrollable(ScrollDirection.Horizontal)
        // 横向滚动条按片出现会变成好几条，统一关掉（表格仍可横向拖动，各片同步移动）
        .scrollBar(BarState.Off)
        .width('100%')
        // 横拖任意一片都把偏移广播给同一张表的其余片，整张表一起移动
        .onDidScroll((xOffset: number) => {
            this.sliceSync().onRowScroll(this.sliceScroller, xOffset);
        });
    }

    // 表格分片位置：未设标记表示整张表就是一个单元（既是首片也是末片）
    private tableSliceFirst(table: TableData): boolean {
        return table.sliceFirst !== false;
    }

    private tableSliceLast(table: TableData): boolean {
        return table.sliceLast !== false;
    }

    // 表格列数：aligns 每列一项，分片后非首片的表头为空，不能再用表头长度推算
    private tableColCount(table: TableData): number {
        if (table.aligns.length > 0) {
            return table.aligns.length;
        }

        if (table.headers.length > 0) {
            return table.headers.length;
        }

        if (table.rows.length > 0) {
            return table.rows[0].length;
        }

        return 1;
    }

    private tableRadius(table: TableData): BorderRadiuses {
        const first: boolean = this.tableSliceFirst(table);
        const last: boolean = this.tableSliceLast(table);

        return {
            topLeft: first ? Radius.sm : 0,
            topRight: first ? Radius.sm : 0,
            bottomLeft: last ? Radius.sm : 0,
            bottomRight: last ? Radius.sm : 0
        };
    }

    private tableBorderWidth(table: TableData): EdgeWidths {
        const first: boolean = this.tableSliceFirst(table);
        const last: boolean = this.tableSliceLast(table);
        const side: number = 0.5;

        return {
            top: first ? side : 0,
            bottom: last ? side : 0,
            left: side,
            right: side
        };
    }

    // 行内文本：始终使用同一棵 Text -> ForEach -> Span 子树，Span 只改变颜色 / 字重 / 字体，绝不改字号。
    // 不能在这里根据片段数量切换「Text(string)」和「Text + 多个 Span」：
  // Markdown 块的节点身份由 holder id 隔离；块内容更新时只改这一块，避免单栏串台。
    @Builder
    InlineText(pieces: InlinePiece[], fontSize: number, lineHeight: number, style: InlineStyle) {
        Text() {
            ForEach(pieces, (piece: InlinePiece) => {
                if (piece.code) {
                    ContainerSpan() {
                        Span(piece.text)
                            .fontSize(fontSize)
                            .fontFamily(MONO_FONT)
                            .fontColor($r('app.color.code_text'));
                    }
                    .textBackgroundStyle({ color: $r('app.color.code_bg'), radius: Radius.xs });
                } else {
                    Span(this.renderLinkPrefix(piece) + piece.text)
                        .fontSize(fontSize)
                        .fontWeight(piece.bold ? FontWeight.Bold : FontWeight.Regular)
                        .fontStyle(piece.italic ? FontStyle.Italic : FontStyle.Normal)
                        .fontColor(this.spanColor(piece))
                        .decoration(piece.href.length > 0
                            ? { type: TextDecorationType.Underline, color: $r('app.color.text_brand') }
                            : { type: TextDecorationType.None });
                }
            }, (piece: InlinePiece, index: number) => this.inlinePieceKey(piece, index));
        }
        .fontSize(fontSize)
        .lineHeight(lineHeight)
        .width('100%')
        .wordBreak(WordBreak.BREAK_WORD)
        .textAlign(style.align === undefined ? TextAlign.Start : style.align)
        .fontColor(style.color === undefined ? $r('app.color.text_primary') : style.color)
        .fontWeight(style.bold === true ? FontWeight.Bold : FontWeight.Regular)
        .layoutWeight(style.fill === true ? 1 : 0)
        .padding({
            left: style.paddingLeft === undefined ? 0 : style.paddingLeft,
            right: style.paddingRight === undefined ? 0 : style.paddingRight
        })
        .margin({
            top: style.marginTop === undefined ? 0 : style.marginTop,
            bottom: style.marginBottom === undefined ? 0 : style.marginBottom
        });
    }

    // 节点 key 带块持有者 id：同一个复用行换到另一条 Markdown 块时，
    // 即使片段位置和样式相同，也必须创建新的 Span，不能让 ArkUI 沿用上一行的文字节点。
    private inlinePieceKey(piece: InlinePiece, index: number): string {
        return this.holder.id + '_i_' + index + '_' + piece.href + '_' + (piece.code ? 'code' : 'text');
    }

    private listItemKey(item: ListItem, index: number): string {
        let text: string = '';

        for (let i: number = 0; i < item.inline.length; i++) {
            text += item.inline[i].text;
        }

        return this.holder.id + '_l_' + index + '_' + item.marker + '_' + text;
    }

    private tableRowKey(index: number): string {
        return this.holder.id + '_r_' + index;
    }

    private tableCellKey(prefix: string, index: number): string {
        return this.holder.id + '_' + prefix + '_' + index;
    }

    // 链接前缀：渲染层没有行内图片能力，用 ⟩ 提示可跳转
    private renderLinkPrefix(piece: InlinePiece): string {
        return piece.href.length > 0 ? '⟩ ' : '';
    }

    private spanColor(piece: InlinePiece): ResourceColor {
        return piece.href.length > 0 ? $r('app.color.text_brand') : $r('app.color.text_primary');
    }

    // 表格列对齐：按分隔行解析的 aligns 取值，越界默认左对齐
    private tableAlign(aligns: string[], index: number): TextAlign {
        if (index >= aligns.length) {
            return TextAlign.Start;
        }

        const align: string = aligns[index];

        if (align === 'center') {
            return TextAlign.Center;
        }

        if (align === 'right') {
            return TextAlign.End;
        }

        return TextAlign.Start;
    }

    // 表格最小宽度：每列至少 120vp，列多时撑出横向滚动区域，列少时撑满容器
    private tableMinWidth(colCount: number): number {
        return colCount * 120;
    }

    private copyToClipboard(text: string): void {
        const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
        pasteboard.getSystemPasteboard().setData(data);
        promptAction.showToast({ message: '代码已复制', duration: 1200 });
    }
}
