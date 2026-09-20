// ChatItemBuilder.ets - 把一条消息展开成块级渲染单元
//
// 展开规则与旧 MessageBubble 的渲染结构逐项对齐，保证拆分后视觉与行为不变：
//   用户消息            → 1 个 USER_MESSAGE 单元（气泡 + 附件整体渲染）
//   助手消息            → 头像单元 + 每个分段各成单元（思考 / 工具卡 / 选择题卡 / 错误行）
//                         其中 content 分段再按 Markdown AST 拆成 N 个块单元
//   流式占位 / 顶层错误 / 用量条 / 操作条 → 各自的收尾单元
// function_result 分段不单独成行：它由工具卡自身渲染（与旧行为一致）。

import { ChatMessage, MessageSegment, ToolCallItem } from './ChatTypes';
import { InlinePiece, MarkdownBlock, MarkdownParser, ListItem as MdListItem, TableData } from './MarkdownParser';
import { QuestionItem } from './QuestionLocks';
import { FontSize, Space } from './DesignToken';
import { ChatItemKind, ChatRenderItem, MarkdownBlockHolder } from './ChatRenderItem';
import { isExaWebSearchToolName } from './ExaMedia';

// 内容缓存条目：流式增量解析时复用已解析的块，只重新解析最后一个块
interface ContentCacheEntry {
    text: string;
    blocks: MarkdownBlock[];
    finalized: boolean;
}

// 段落切片游标：index 指向当前片段，offset 是该片段内已消费的字符数。
// 只有「一个片段跨两片」时才需要 offset 非零
class InlineCursor {
    pieces: InlinePiece[];
    index: number = 0;
    offset: number = 0;

    constructor(pieces: InlinePiece[]) {
        this.pieces = pieces;
    }
}

// 列表块每行放多少个条目。
// 理由：列表的内部行距与列表行之间的行距都是 Space.xs(4vp)，按条目分组后视觉完全连续，
// 是唯一可以零代价拆小的块类型。单行的最高高度因此从「整张列表」收敛到「2 个条目」。
//
// 为什么是 1：位置跳变的幅度 = |行高 − 引擎对未测量行的估算均值|，超过 24vp 就会看出位移。
// 实测估算均值随已测行浮动（约 34~44vp）。收到 2 个条目后，短条目行约 44vp 已经落回带内，
// 但**条目本身含长文本**时（条目内折成 2 行）单行仍有 81~106vp —— 实测 301 个建行里
// 52 个过高行有 25 个是 list，是越界行的最大单一来源。
// 1 项/行后短条目约 22vp、长条目约 51vp，两端都进带；列表项间距与切片接缝间距
// 同为 Space.xs(4vp)，接缝与片内行距一致，视觉零变化。
// 条目自带 marker，切分不改变任何显示内容
const LIST_ITEMS_PER_ROW: number = 1;

// 列表行装填上限（估算行数）。取 2 行与段落切片同档：
// 行高集中在 2 行文本高度附近，既压低了视口内的行数（滚动期单帧布局成本与行数成正比），
// 又让「行高 − 已测行均值」留在 24vp 带内 —— 超出这个带就会看到位置跳变
const LIST_GROUP_MAX_LINES: number = 2;

// 列表条目的文本可用宽度比块级文本窄：marker 是固定 18vp 宽（见 MarkdownBlock.ListBlock），
// 与文本之间还有 Space.sm 的间距。用块级宽度折算每行容量会高估约 9%：
// 「2 行预算」的条目实际折成 3 行，两个 1 行条目拼成的行组实际折成 4 行 ——
// 行高越过引擎对未测量行的估值带宽（均值 ± 24vp），在滚动中就是可见位移。
// 因此列表侧按真实可用宽度折算每行单位数
const LIST_MARKER_WIDTH: number = 18;

// 表格每片放多少个数据行。
// 表格数据行约 43vp，而引擎对未测量行的估算均值约 40vp（实测，随已测行浮动）——
// 每片 1 行（约 43vp）误差趋近于零，2 行（约 90vp）则会稳定产生约 50vp 的位移。
// 这个误差就是滚动中可见位移的量：整张 7 行表（约 344vp）一次进入时误差约 300vp（三分之一屏）。
// 因此收到 1 行/片。表头只留在第一片，圆角与边框按分片位置补，各片共享横向偏移
const TABLE_ROWS_PER_SLICE: number = 1;

// 代码块每片放多少个源码行。
// 代码行高 = LineHeight.bodyCode(22vp)，估算均值实测约 40vp，因此 2 行（约 44vp）最接近，
// 4 行（约 88vp）会稳定产生约 48vp 位移。长代码块是块级拆分后剩余最高的行
// （实测最高 529vp，单次测量位移可达约 490vp），是滚动中位置跳变的主要来源之一。
// 语言栏只留在首片，底 padding 只留在末片，片间无接缝间距
const CODE_LINES_PER_SLICE: number = 2;

// 用户提问按多少个源码行切片（仅对无附件的长文本生效）。
// 用户气泡是全列表最高的行：实测最长提问 1029vp（约 25 倍估算均值 40vp），它在视口上方
// 首次测量时会把下方可见内容整体推移近千 vp，是滚动跳变最大的单一来源。
// 切片后每片 4 行 ≈ 51vp（实测），落在均值附近；文本按源码行切分不会截断换行，视觉完全连续。
// 各片必须同宽才能拼成同一个气泡，固定 78%（与自适应气泡的最大宽度一致，见 ChatItemRow）
const USER_LINES_PER_SLICE: number = 4;

// 同一个块被切开后的接缝间距（vp）。
// 列表内部行距就是 Space.xs，表格内部本无间隙 —— 接缝必须与块内部间距一致，
// 否则切开处会露出空隙，看起来像被截断了
const LIST_SLICE_GAP: number = Space.xs;
const TABLE_SLICE_GAP: number = 0;
const CODE_SLICE_GAP: number = 0;
const PARAGRAPH_SLICE_GAP: number = 0;

// 段落每片最多几行文本。
// 段落原先完全不切，是块级拆分后剩下的唯一没有切片的文本块：实测最长 102vp（4 行），
// 而估算均值约 34~44vp —— 3~4 行的段落稳定产生 +34~+63vp 的正向位移（52 个过高行里 7 个是段落）。
// 切成 2 行/片后每片约 50vp，落回带内
const PARAGRAPH_LINES_PER_SLICE: number = 2;

// 标题每片最多几行。标题取 1 行：h1 折两行就有约 66vp，已越过「均值 + 24vp」的上沿
const HEADING_LINES_PER_SLICE: number = 1;

// 文本块可用宽度的缺省值（vp）：屏宽 360 − 行容器左右 padding(Space.lg × 2 = 32)。
// 真机屏宽并不总是 360：本机 1080px / density 440 = 392.7vp，实际可用 360.7vp。
// 预算偏小会让每片的字符预算偏小，切点对不上真实折行位置，每片白吃一行 ——
// 行数变多，滚动期单帧布局成本随之上升。因此以列表实测宽度为准覆盖（setContentWidth）
const TEXT_BUDGET_WIDTH_FALLBACK: number = 328;

// 标题各级字号，必须与 components/chat/MarkdownBlock.ets 的 HEADING_SIZES 一致 ——
// 两侧都靠它折算切片点，不一致会让标题多折一行
const HEADING_FONT_SIZES: number[] = [FontSize.display, FontSize.titleLarge, FontSize.title,
    FontSize.bodyLarge, FontSize.body, FontSize.body];

export class ChatItemBuilder {
    // 流式期间每帧都调用 build → MarkdownParser.parse 解析整段 content，成本随内容增长线性上升。
    // 缓存每条消息上次解析的 content 文本和块列表：content 是前缀扩展时（流式追加的常态），
    // 只从最后一个块的 sourceStart 处重新解析到末尾，前面的块直接复用
    private static contentCache: Map<string, ContentCacheEntry> = new Map();

    static clearCache(messageUid: string): void {
        ChatItemBuilder.contentCache.delete(messageUid);
    }

    static clearAllCache(): void {
        ChatItemBuilder.contentCache.clear();
    }

    // 解析 content 分段的 Markdown，支持增量解析；流结束时必须重新解析完整文本。
    // 流式期间最后一个块可能暂时只有半个 ** / ` / 链接标记，缓存里的字面量只是中间态。
    // 如果 done 后 text 没再变化，单看 text === cached.text 会把这个中间态永久带进最终画面。
    private static parseContent(messageUid: string, text: string, finalized: boolean): MarkdownBlock[] {
        const cached: ContentCacheEntry | undefined =
            ChatItemBuilder.contentCache.get(messageUid);

        if (cached !== undefined && text === cached.text && (!finalized || cached.finalized)) {
            return cached.blocks;
        }

        if (finalized) {
            const blocks: MarkdownBlock[] = MarkdownParser.parse(text);
            ChatItemBuilder.cacheContent(messageUid, text, blocks, true);
            return blocks;
        }

        if (cached === undefined) {
            const blocks: MarkdownBlock[] = MarkdownParser.parse(text);
            ChatItemBuilder.cacheContent(messageUid, text, blocks, false);
            return blocks;
        }

        if (text.length < cached.text.length || !text.startsWith(cached.text)) {
            const blocks: MarkdownBlock[] = MarkdownParser.parse(text);
            ChatItemBuilder.cacheContent(messageUid, text, blocks, false);
            return blocks;
        }

        if (cached.blocks.length === 0) {
            const blocks: MarkdownBlock[] = MarkdownParser.parse(text);
            ChatItemBuilder.cacheContent(messageUid, text, blocks, false);
            return blocks;
        }

        const lastBlock: MarkdownBlock = cached.blocks[cached.blocks.length - 1];
        const lastBlockStart: number | undefined = lastBlock.sourceStart;

        if (lastBlockStart === undefined) {
            const blocks: MarkdownBlock[] = MarkdownParser.parse(text);
            ChatItemBuilder.cacheContent(messageUid, text, blocks, false);
            return blocks;
        }

        const tailBlocks: MarkdownBlock[] = MarkdownParser.parse(text.substring(lastBlockStart));
        const blocks: MarkdownBlock[] = [...cached.blocks.slice(0, -1), ...tailBlocks];

        ChatItemBuilder.cacheContent(messageUid, text, blocks, false);
        return blocks;
    }

    // 统一写入解析缓存，明确记录缓存是否已经经过最终态校验。
    private static cacheContent(messageUid: string, text: string, blocks: MarkdownBlock[], finalized: boolean): void {
        ChatItemBuilder.contentCache.set(messageUid, {
            text: text,
            blocks: blocks,
            finalized: finalized
        });
    }

    // 展开一条消息。返回顺序即渲染顺序，order 从 0 递增且在一次展开内稳定
    static build(message: ChatMessage): ChatRenderItem[] {
        // 首次展开即冻结切片宽度：此后再有人写宽度都不会生效。
        // 键 = uid#order 必须稳定映射到同一段文本，宽度中途变化会直接打破这个对应关系
        ChatItemBuilder.freezeContentWidth();

        const items: ChatRenderItem[] = [];

        if (message.isUser) {
            // 短提问 / 带附件的提问维持整条一个单元（自适应宽度气泡）；
            // 带附件时切片会让附件区脱离气泡，先不切（长文本+附件较少见）
            const lineCount: number = message.content.split('\n').length;

            if (lineCount <= USER_LINES_PER_SLICE || message.attachments.length > 0) {
                const single: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.USER_MESSAGE, 0);
                single.userSliceTotal = 1;
                items.push(single);
                ChatItemBuilder.markEdges(items);
                return items;
            }

            // 长提问按行切片：每片独立成行，气泡外观按片位拼接（见 ChatItemRow.UserBubbleSlice）。
            // 定长切片保证键稳定：同一条消息的第 N 片始终复用同一行
            const lines: string[] = message.content.split('\n');
            let userOrder: number = 0;

            for (let start: number = 0; start < lines.length; start += USER_LINES_PER_SLICE) {
                const sliceLast: boolean = start + USER_LINES_PER_SLICE >= lines.length;
                const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.USER_MESSAGE, userOrder++);
                item.text = lines.slice(start, start + USER_LINES_PER_SLICE).join('\n');
                item.userSliceTotal = Math.ceil(lines.length / USER_LINES_PER_SLICE);
                item.gapBelow = sliceLast ? -1 : 0;
                items.push(item);
            }

            ChatItemBuilder.markEdges(items);
            return items;
        }

        items.push(new ChatRenderItem(message, ChatItemKind.ASSISTANT_AVATAR, 0));

        let order: number = 1;
        let hasContent: boolean = false;

        for (let i: number = 0; i < message.segments.length; i++) {
            const segment: MessageSegment = message.segments[i];
            const isLast: boolean = i === message.segments.length - 1;

            if (segment.type === 'reasoning') {
                const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.REASONING, order++);
                item.reasoningText = segment.text;
                item.reasoningStreaming = message.streaming && isLast;
                item.reasoningExpanded = message.thinkingExpanded;
                items.push(item);
                continue;
            }

            if (segment.type === 'content') {
                const blocks: MarkdownBlock[] = ChatItemBuilder.parseContent(
                    message.uid, segment.text, !message.streaming);

                for (let b: number = 0; b < blocks.length; b++) {
                    const block: MarkdownBlock = blocks[b];

                    if (block.type === 'list' && block.items.length > LIST_ITEMS_PER_ROW) {
                        order = ChatItemBuilder.pushListSlices(items, message, order, block);
                        hasContent = true;
                        continue;
                    }

                    if (block.type === 'table' && block.table !== null
                        && block.table.rows.length > TABLE_ROWS_PER_SLICE) {
                        order = ChatItemBuilder.pushTableSlices(items, message, order, block);
                        hasContent = true;
                        continue;
                    }

                    if (block.type === 'code'
                        && block.codeText.split('\n').length > CODE_LINES_PER_SLICE) {
                        order = ChatItemBuilder.pushCodeSlices(items, message, order, block);
                        hasContent = true;
                        continue;
                    }

                    if (block.type === 'paragraph'
                        && ChatItemBuilder.inlineUnits(block.inline)
                            > PARAGRAPH_LINES_PER_SLICE * ChatItemBuilder.lineUnitsFor(FontSize.body)) {
                        order = ChatItemBuilder.pushTextSlices(items, message, order, block,
                            PARAGRAPH_LINES_PER_SLICE, FontSize.body);
                        hasContent = true;
                        continue;
                    }

                    if (block.type === 'heading'
                        && ChatItemBuilder.inlineUnits(block.inline)
                            > HEADING_LINES_PER_SLICE
                                * ChatItemBuilder.lineUnitsFor(HEADING_FONT_SIZES[block.level - 1])) {
                        order = ChatItemBuilder.pushTextSlices(items, message, order, block,
                            HEADING_LINES_PER_SLICE, HEADING_FONT_SIZES[block.level - 1]);
                        hasContent = true;
                        continue;
                    }

                    const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.CONTENT_BLOCK, order++);
                    item.blockHolder = new MarkdownBlockHolder(block);
                    items.push(item);
                    hasContent = true;
                }

                continue;
            }

            if (segment.type === 'function_call') {
                const call: ToolCallItem | undefined = ChatItemBuilder.findToolCall(message, segment.callId ?? '');

                if (call !== undefined) {
                    const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.TOOL_CALL, order++);
                    item.toolCall = call;
                    items.push(item);

                    // Exa 画廊在工具结果到达后才有图片，但它的列表行必须从工具调用出现时就存在。
                    // 这样后续 Markdown 的 index/key 不会因画廊异步插入而改变，且列表从一开始就为画廊保留高度。
                    if (isExaWebSearchToolName(call.name)) {
                        const gallery: ChatRenderItem = new ChatRenderItem(
                            message, ChatItemKind.TOOL_GALLERY, order++);
                        gallery.toolCall = call;
                        items.push(gallery);
                    }
                }

                continue;
            }

            if (segment.type === 'question') {
                const question: QuestionItem | undefined = ChatItemBuilder.findQuestion(message, segment.callId ?? '');

                if (question !== undefined) {
                    const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.QUESTION, order++);
                    item.question = question;
                    items.push(item);
                }

                continue;
            }

            if (segment.type === 'error') {
                const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.SEGMENT_ERROR, order++);
                item.text = segment.text;
                items.push(item);
            }
        }

        if (message.streaming && !hasContent && !message.hasToolCalls && !message.hasThinking
            && !message.hasQuestions) {
            items.push(new ChatRenderItem(message, ChatItemKind.STREAMING_DOTS, order++));
        }

        if (message.errorMessage.length > 0) {
            const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.ERROR_LINE, order++);
            item.text = message.errorMessage;
            items.push(item);
        }

        if (message.usage !== null) {
            const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.USAGE, order++);
            item.usage = message.usage;
            item.modelName = message.modelName;
            items.push(item);
        }

        if (!message.streaming && message.content.length > 0) {
            items.push(new ChatRenderItem(message, ChatItemKind.ACTIONS, order++));
        }

        ChatItemBuilder.markEdges(items);
        return items;
    }

    // 把一张列表装填成多行，两条规则：
    //   1) 按估算高度贪心装填，每行不超过 LIST_GROUP_MAX_LINES 行文本 ——
    //      行数最少、行高集中在同一档。滚动期单帧布局成本与视口内行数成正比，
    //      行数就是 120Hz 的帧预算（约 8.3ms），所以装填优先；
    //   2) 单个条目自身就超过该高度时，对条目自己的行内文本继续切片。
    //      markdown 里条目折行本来就不带 marker（续行与首行文字左对齐），
    //      因此续片留空 marker、保留同等缩进即可，视觉与自然折行完全一致。
    private static pushListSlices(items: ChatRenderItem[], message: ChatMessage, order: number,
        block: MarkdownBlock): number {
        const perLineUnits: number = Math.max(6, Math.floor(
            (ChatItemBuilder.textBudgetWidth - LIST_MARKER_WIDTH - Space.sm) / FontSize.body));
        const maxUnits: number = LIST_GROUP_MAX_LINES * perLineUnits;
        const rows: MdListItem[][] = [];
        let group: MdListItem[] = [];
        let groupLines: number = 0;

        for (let i: number = 0; i < block.items.length; i++) {
            const source: MdListItem = block.items[i];
            const cursorAt: InlineCursor = new InlineCursor(source.inline);
            let firstPart: boolean = true;
            let produced: boolean = false;

            while (cursorAt.index < source.inline.length) {
                const slice: InlinePiece[] = ChatItemBuilder.takeUnits(cursorAt, maxUnits);

                if (slice.length === 0) {
                    break;
                }

                const part: MdListItem = {
                    marker: firstPart ? source.marker : '',
                    inline: slice,
                    continuation: !firstPart
                };
                const partUnits: number = Math.max(1, ChatItemBuilder.inlineUnits(slice));
                const partLines: number = ChatItemBuilder.linesFor(partUnits, perLineUnits);
                const isContinuation: boolean = !firstPart;
                produced = true;

                // 续片独占一行；装不下的条目另起一行。
                // 按「行数」累加而不是「单位数」：列表条目各自独立折行，整行行数是
                // 「每条自身上取整」之和，不是「宽度之和 ÷ 每行容量」。24 单位（2 行）
                // + 20 单位（1 行）合计 44 单位看着刚好 2 行，实际渲染 3 行（h=81），
                // 越出引擎对未测量行的估值带宽（均值 ± 24vp）→ 滚动期可见位移
                if (group.length > 0 && (isContinuation || groupLines + partLines > LIST_GROUP_MAX_LINES)) {
                    rows.push(group);
                    group = [];
                    groupLines = 0;
                }

                group.push(part);
                groupLines += partLines;
                firstPart = false;
            }

            // 空条目（只有 marker、没有文本）也要占一行，否则条目会凭空消失
            if (!produced) {
                if (group.length > 0) {
                    rows.push(group);
                    group = [];
                    groupLines = 0;
                }

                const empty: MdListItem = { marker: source.marker, inline: source.inline, continuation: false };
                group.push(empty);
                groupLines += 1;
            }
        }

        if (group.length > 0) {
            rows.push(group);
        }

        let cursor: number = order;

        for (let r: number = 0; r < rows.length; r++) {
            const row: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.CONTENT_BLOCK, cursor++);
            row.blockHolder = new MarkdownBlockHolder(ChatItemBuilder.listSlice(block, rows[r]));
            row.gapBelow = r < rows.length - 1 ? LIST_SLICE_GAP : -1;
            items.push(row);
        }

        return cursor;
    }

    // 把一张表格按数据行切成多片：表头只留在第一片，圆角与边框按分片位置补
    // （见 MarkdownBlock.TableContent），各片共享一份横向偏移（见 common/TableScrollSync.ets）。
    // 定长切片是要点：流式期间新到达的数据行只会新增末尾的分片，
    // 已有分片的边界不动，列表不必重建已存在的行
    private static pushTableSlices(items: ChatRenderItem[], message: ChatMessage, order: number,
        block: MarkdownBlock): number {
        const table: TableData | null = block.table;

        if (table === null) {
            return order;
        }

        // 表身份：所有分片用同一个键，横向偏移才能共享；uid 与首片序号在一次展开内稳定
        const syncKey: string = message.uid + '#table' + order;
        let cursor: number = order;

        for (let start: number = 0; start < table.rows.length; start += TABLE_ROWS_PER_SLICE) {
            const last: boolean = start + TABLE_ROWS_PER_SLICE >= table.rows.length;
            const rows: InlinePiece[][][] = table.rows.slice(start, start + TABLE_ROWS_PER_SLICE);
            const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.CONTENT_BLOCK, cursor++);
            const holder: MarkdownBlockHolder = new MarkdownBlockHolder(
                ChatItemBuilder.tableSlice(block, start === 0, last, rows));

            holder.sliceSyncKey = syncKey;
            item.blockHolder = holder;
            item.gapBelow = last ? -1 : TABLE_SLICE_GAP;
            items.push(item);
        }

        return cursor;
    }

    // 把一个代码块按源码行切成多片：语言栏与复制按钮只留在首片，底 padding 只留在末片，
    // 圆角按分片位置补。定长切片与表格同理：流式新增的代码行只会新增末尾的分片，
    // 已有分片的边界（含文本内容）不动，列表不必重建已存在的行。
    // 各片共用横向偏移（与表格同一套机制），键 = uid + '#code' + 首片序号，跨重建保持
    private static pushCodeSlices(items: ChatRenderItem[], message: ChatMessage, order: number,
        block: MarkdownBlock): number {
        const lines: string[] = block.codeText.split('\n');
        const syncKey: string = message.uid + '#code' + order;
        let cursor: number = order;

        for (let start: number = 0; start < lines.length; start += CODE_LINES_PER_SLICE) {
            const last: boolean = start + CODE_LINES_PER_SLICE >= lines.length;
            const sliceText: string = lines.slice(start, start + CODE_LINES_PER_SLICE).join('\n');
            const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.CONTENT_BLOCK, cursor++);
            const holder: MarkdownBlockHolder = new MarkdownBlockHolder(
                ChatItemBuilder.codeSlice(block, start === 0, last, sliceText));

            holder.sliceSyncKey = syncKey;
            item.blockHolder = holder;
            item.gapBelow = last ? -1 : CODE_SLICE_GAP;
            items.push(item);
        }

        return cursor;
    }

    // 构造表格切片：表头只在第一片保留，非首片的 headers 为空数组
    private static tableSlice(block: MarkdownBlock, first: boolean, last: boolean,
        rows: InlinePiece[][][]): MarkdownBlock {
        const table: TableData | null = block.table;

        return {
            type: block.type,
            level: block.level,
            language: block.language,
            codeText: block.codeText,
            ordered: block.ordered,
            inline: block.inline,
            items: block.items,
            table: {
                headers: first && table !== null ? table.headers : [],
                rows: rows,
                aligns: table !== null ? table.aligns : [],
                sliceFirst: first,
                sliceLast: last
            }
        };
    }

    // 构造代码切片：语言/复制栏只在首片，末片补底 padding（视图按 codeSliceFirst/Last 取值）；
    // 首片携带完整源码 codeFullText，复制按钮才能复制整段而不是第一片
    private static codeSlice(block: MarkdownBlock, first: boolean, last: boolean, text: string): MarkdownBlock {
        return {
            type: block.type,
            level: block.level,
            language: block.language,
            codeText: text,
            ordered: block.ordered,
            inline: block.inline,
            items: block.items,
            table: block.table,
            codeSliceFirst: first,
            codeSliceLast: last,
            codeFullText: first ? block.codeText : ''
        };
    }

    private static textBudgetWidth: number = TEXT_BUDGET_WIDTH_FALLBACK;

    // 切片宽度冻结标记 —— 这是「对话串台」的唯一防线。
    // 列表键取「消息身份 # 单元序号」，隐含契约是「键 = 内容」：同一个键必须始终切出同一段文本。
    // 而切点由 textBudgetWidth 决定，行高又反过来由切点决定 —— 宽度一旦在构建之后变化，
    // 同一个键就会先后切出不同文本（例如 1 行 → 4 行），表现为整段对话被拆散、混进别的提问。
    // 因此：第一次展开之前允许写入（此时还没有任何已定型的键），第一次展开之后永久冻结
    private static widthLocked: boolean = false;

    // 写入可用文本宽度（vp）。冻结之后一律无效。
    // 切片点必须贴着真实折行位置：预算取错会让切片处凭空多出一行，行数上升就是滚动期单帧成本的直接来源
    static setContentWidth(width: number): void {
        if (ChatItemBuilder.widthLocked) {
            return;
        }

        if (width > 120 && Math.abs(width - ChatItemBuilder.textBudgetWidth) > 1) {
            ChatItemBuilder.textBudgetWidth = width;
        }
    }

    // 冻结切片宽度。由 build() 在首次展开时自动调用：一旦有键定型，宽度就不允许再变
    static freezeContentWidth(): void {
        ChatItemBuilder.widthLocked = true;
    }

    static isContentWidthLocked(): boolean {
        return ChatItemBuilder.widthLocked;
    }

    static currentContentWidth(): number {
        return ChatItemBuilder.textBudgetWidth;
    }

    // 行构建成本探针：aboutToAppear → 首次布局完成的耗时（ms）。
    // 滚动期单帧成本与「这一帧建了几行」直接相关，而建行成本要么是「每行固定开销」，
    // 要么是「行内容渲染」：前者只能靠减行数，后者该去减内容。这个数用来说清是哪一种
    // 按 kind 分组：最简行（助手头像 = 一个渐变圆、用量条 = 两行小字）如果也要十几毫秒，
    // 那就与内容无关，是「行容器 + 绑定 + 布局」的固定开销，只能靠减行数解决；
    // 反之若重内容行显著更贵，才该去减行内节点
    private static rowCostCount: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    private static rowCostTotal: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    private static rowCostMax: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    private static rowCostHeight: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    static noteRowCost(kind: number, height: number, ms: number): void {
        const k: number = (kind < 0 || kind > 11) ? 11 : kind;
        ChatItemBuilder.rowCostCount[k]++;
        ChatItemBuilder.rowCostTotal[k] += ms;
        ChatItemBuilder.rowCostHeight[k] = Math.round(height);

        if (ms > ChatItemBuilder.rowCostMax[k]) {
            ChatItemBuilder.rowCostMax[k] = ms;
        }
    }

    // 取出并清零。返回空串表示这一段没有任何建行 —— 那说明建行都落在空闲帧里了
    static takeRowCost(): string {
        let out: string = '';

        for (let k: number = 0; k < 12; k++) {
            const count: number = ChatItemBuilder.rowCostCount[k];

            if (count === 0) {
                continue;
            }

            // 每档格式：k<kind>=<行数>/<均值ms>/<峰值ms>/h<该档最后一次行高>
            out += ' k' + k + '=' + count
                + '/' + Math.round(ChatItemBuilder.rowCostTotal[k] / count)
                + '/' + ChatItemBuilder.rowCostMax[k]
                + '/h' + ChatItemBuilder.rowCostHeight[k];
            ChatItemBuilder.rowCostCount[k] = 0;
            ChatItemBuilder.rowCostTotal[k] = 0;
            ChatItemBuilder.rowCostMax[k] = 0;
            ChatItemBuilder.rowCostHeight[k] = 0;
        }

        return out;
    }

    // 一行能容纳的全角单位数 = 可用宽度 ÷ 字号。
    // 切片点必须贴着真实折行位置：片宽一旦超过一行容量，该片就会多折一行，
    // 把「切分」暴露成视觉变化（正文 15vp → 21 单位，与实测的每行 22 字一致）
    private static lineUnitsFor(fontSize: number): number {
        return Math.max(6, Math.floor(ChatItemBuilder.textBudgetWidth / fontSize));
    }

    // 把一段文本块（段落 / 标题）按估算行数切成多片。切点只由字符宽度决定，不改动任何文本。
    // 预算取「每片行数 × 每行单位」的整数倍，因此片数恰好等于原折行数 —— 总高与切前相同。
    // 片间接缝间距取 0，InlineText 的行盒高度自带宽高，接缝处的行距与片内完全一致
    private static pushTextSlices(items: ChatRenderItem[], message: ChatMessage, order: number,
        block: MarkdownBlock, linesPerSlice: number, fontSize: number): number {
        const budget: number = linesPerSlice * ChatItemBuilder.lineUnitsFor(fontSize);
        const cursorAt: InlineCursor = new InlineCursor(block.inline);
        let first: boolean = true;
        let cursor: number = order;

        while (cursorAt.index < block.inline.length) {
            const slice: InlinePiece[] = ChatItemBuilder.takeUnits(cursorAt, budget);

            if (slice.length === 0) {
                break;
            }

            // 游标走完即末片：比按宽度累加判断可靠（浮点累积会有误差）
            const last: boolean = cursorAt.index >= block.inline.length;
            const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.CONTENT_BLOCK, cursor++);
            item.blockHolder = new MarkdownBlockHolder(ChatItemBuilder.textSlice(block, slice, first, last));
            item.gapBelow = last ? -1 : PARAGRAPH_SLICE_GAP;
            items.push(item);
            first = false;
        }

        return cursor;
    }

    // 从游标处取出一片：依次吃进行内片段，直到累计宽度达到 budget。
    // 单个片段超长时在片段内部按字符断开（保留原样式），剩余部分留在游标上给下一片
    private static takeUnits(cursorAt: InlineCursor, budget: number): InlinePiece[] {
        const out: InlinePiece[] = [];
        let used: number = 0;

        while (cursorAt.index < cursorAt.pieces.length && used < budget) {
            const piece: InlinePiece = cursorAt.pieces[cursorAt.index];
            const rest: string = piece.text.substring(cursorAt.offset);
            const width: number = ChatItemBuilder.charUnits(rest);

            if (used + width <= budget) {
                const whole: InlinePiece = {
                    text: rest, bold: piece.bold, italic: piece.italic,
                    code: piece.code, href: piece.href
                };
                out.push(whole);
                used += width;
                cursorAt.index++;
                cursorAt.offset = 0;
                continue;
            }

            const room: number = budget - used;
            let taken: number = 0;
            let units: number = 0;

            while (taken < rest.length) {
                const unit: number = ChatItemBuilder.charUnits(rest.charAt(taken));

                if (units + unit > room) {
                    break;
                }

                units += unit;
                taken++;
            }

            // 一个字符都放不下（剩余宽度小于最小字符单位）：已经攒到东西就留给下一轮，
            // 否则强制前进一个字符 —— 否则游标不动，剩余内容会被整段丢掉
            if (taken === 0) {
                if (out.length > 0) {
                    break;
                }

                taken = 1;
            }

            // 不能把代理对切开：切点落在高代理之后时，这一对完整留给下一片
            if (taken < rest.length
                && rest.charCodeAt(taken - 1) >= 0xD800 && rest.charCodeAt(taken - 1) <= 0xDBFF
                && rest.charCodeAt(taken) >= 0xDC00 && rest.charCodeAt(taken) <= 0xDFFF) {
                taken++;
            }

            const head: InlinePiece = {
                text: rest.substring(0, taken), bold: piece.bold, italic: piece.italic,
                code: piece.code, href: piece.href
            };
            out.push(head);
            cursorAt.offset += taken;
            used += units;
        }

        return out;
    }

    // 一段行内片段占几行 = ceil(单位数 / 每行容量)，至少 1 行。
    // 列表装填必须按它累加：按宽度累加会低估行数（每条独立折行各有一次上取整损耗）
    private static linesFor(units: number, perLineUnits: number): number {
        return Math.max(1, Math.ceil(units / perLineUnits));
    }

    // 行内片段序列的估算宽度（全角单位）
    private static inlineUnits(pieces: InlinePiece[]): number {
        let total: number = 0;

        for (let i: number = 0; i < pieces.length; i++) {
            total += ChatItemBuilder.charUnits(pieces[i].text);
        }

        return total;
    }

    // 字符串的估算宽度：全角 / CJK 记 1 个单位，半角记 0.55
    private static charUnits(text: string): number {
        let total: number = 0;

        for (let i: number = 0; i < text.length; i++) {
            total += text.charCodeAt(i) < 0x2E80 ? 0.55 : 1;
        }

        return total;
    }

    private static textSlice(block: MarkdownBlock, inline: InlinePiece[],
        first: boolean, last: boolean): MarkdownBlock {
        return {
            type: block.type,
            level: block.level,
            language: block.language,
            codeText: block.codeText,
            ordered: block.ordered,
            inline: inline,
            items: block.items,
            table: block.table,
            textSliceFirst: first,
            textSliceLast: last
        };
    }

    // 构造列表切片：字段逐项复制而不是展开语法，避免 ArkTS 对象展开的限制
    private static listSlice(block: MarkdownBlock, items: MdListItem[]): MarkdownBlock {
        return {
            type: block.type,
            level: block.level,
            language: block.language,
            codeText: block.codeText,
            ordered: block.ordered,
            inline: block.inline,
            items: items,
            table: block.table
        };
    }

    // 标记消息的首 / 末单元：首单元负责消息之间的留白，末单元供滚动定位收尾
    private static markEdges(items: ChatRenderItem[]): void {
        if (items.length === 0) {
            return;
        }

        items[0].firstOfMessage = true;
        items[items.length - 1].lastOfMessage = true;
    }

    private static findToolCall(message: ChatMessage, callId: string): ToolCallItem | undefined {
        for (let i: number = 0; i < message.toolCalls.length; i++) {
            if (message.toolCalls[i].callId === callId) {
                return message.toolCalls[i];
            }
        }

        return undefined;
    }

    private static findQuestion(message: ChatMessage, callId: string): QuestionItem | undefined {
        for (let i: number = 0; i < message.questions.length; i++) {
            if (message.questions[i].callId === callId) {
                return message.questions[i];
            }
        }

        return undefined;
    }

    // 把新展开的单元内容写进旧单元对象。
    // 保留对象身份是关键：ChatItemRow 用 @ObjectLink 绑定单元，原地改变字段只重渲染这一行；
    // 换成新对象则要靠数据源通知，流式期间每帧一次通知会把整个列表的重建都带上。
    // 返回是否发生了实际变化，未变化的单元不写字段（避免无意义的行重渲染）
    static copyInto(target: ChatRenderItem, source: ChatRenderItem): boolean {
        let changed: boolean = false;

        if (target.kind !== source.kind || target.order !== source.order) {
            return true;
        }

        if (target.firstOfMessage !== source.firstOfMessage) {
            target.firstOfMessage = source.firstOfMessage;
            changed = true;
        }

        if (target.lastOfMessage !== source.lastOfMessage) {
            target.lastOfMessage = source.lastOfMessage;
            changed = true;
        }

        if (target.gapBelow !== source.gapBelow) {
            target.gapBelow = source.gapBelow;
            changed = true;
        }

        if (target.userSliceTotal !== source.userSliceTotal) {
            target.userSliceTotal = source.userSliceTotal;
            changed = true;
        }

        if (target.reasoningText !== source.reasoningText) {
            target.reasoningText = source.reasoningText;
            changed = true;
        }

        if (target.reasoningStreaming !== source.reasoningStreaming) {
            target.reasoningStreaming = source.reasoningStreaming;
            changed = true;
        }

        if (target.reasoningExpanded !== source.reasoningExpanded) {
            target.reasoningExpanded = source.reasoningExpanded;
            changed = true;
        }

        if (target.text !== source.text) {
            target.text = source.text;
            changed = true;
        }

        if (target.modelName !== source.modelName) {
            target.modelName = source.modelName;
            changed = true;
        }

        // 工具卡与选择题卡是 @Observed 实例，引用不变即视为无变化（其内部字段由卡片自己观察）
        if (target.toolCall !== source.toolCall) {
            target.toolCall = source.toolCall;
            changed = true;
        }

        if (target.question !== source.question) {
            target.question = source.question;
            changed = true;
        }

        if (target.usage !== source.usage) {
            target.usage = source.usage;
            changed = true;
        }

        return ChatItemBuilder.copyBlock(target, source) || changed;
    }

    // 块单元的同步：内容一致就整体跳过，否则把新的块对象换进持有者。
    // 持有者对象身份保持不变，只换它内部持有的 block，于是只有这一行重渲染
    private static copyBlock(target: ChatRenderItem, source: ChatRenderItem): boolean {
        const targetHolder: MarkdownBlockHolder | null = target.blockHolder;
        const sourceHolder: MarkdownBlockHolder | null = source.blockHolder;

        if (sourceHolder === null) {
            if (targetHolder === null) {
                return false;
            }

            target.blockHolder = null;
            return true;
        }

        if (targetHolder === null) {
            target.blockHolder = sourceHolder;
            return true;
        }

        if (ChatItemBuilder.sameBlock(targetHolder.block, sourceHolder.block)) {
            return false;
        }

        targetHolder.block = sourceHolder.block;
        return true;
    }

    // 块内容是否等价：流式增量只会改变最后一块，前面的块逐帧都相同，
    // 因此这里必须先比对再替换，否则每帧都会把所有块行重渲染一遍
    private static sameBlock(a: MarkdownBlock, b: MarkdownBlock): boolean {
        if (a === b) {
            return true;
        }

        if (a.type !== b.type || a.level !== b.level || a.language !== b.language
            || a.ordered !== b.ordered || a.codeText !== b.codeText) {
            return false;
        }

        // 切片标记与首片的完整源码必须参与比对：表格 / 代码块流式增长时原末片会变成中段片，
        // 标记不比对就不会重渲染，接缝处会残留上一态的圆角与 padding；
        // 首片的 codeFullText 不比对，复制按钮会拿到流式过程中的旧源码
        if (a.codeSliceFirst !== b.codeSliceFirst || a.codeSliceLast !== b.codeSliceLast
            || a.codeFullText !== b.codeFullText) {
            return false;
        }

        if (!ChatItemBuilder.sameInline(a.inline, b.inline)) {
            return false;
        }

        if (a.items.length !== b.items.length) {
            return false;
        }

        for (let i: number = 0; i < a.items.length; i++) {
            const left: MdListItem = a.items[i];
            const right: MdListItem = b.items[i];

            if (left.marker !== right.marker || !ChatItemBuilder.sameInline(left.inline, right.inline)) {
                return false;
            }
        }

        return ChatItemBuilder.sameTable(a.table, b.table);
    }

    private static sameInline(a: InlinePiece[], b: InlinePiece[]): boolean {
        if (a.length !== b.length) {
            return false;
        }

        for (let i: number = 0; i < a.length; i++) {
            if (a[i].text !== b[i].text || a[i].bold !== b[i].bold || a[i].italic !== b[i].italic
                || a[i].code !== b[i].code || a[i].href !== b[i].href) {
                return false;
            }
        }

        return true;
    }

    private static sameTable(a: TableData | null, b: TableData | null): boolean {
        if (a === null || b === null) {
            return a === b;
        }

        // 分片位置必须比对：流式加行后原末片降级为中段片，标记不比对就不重渲染，
        // 接缝处会残留上一态的底部圆角与边框，整张表看起来被截成两截
        if (a.sliceFirst !== b.sliceFirst || a.sliceLast !== b.sliceLast) {
            return false;
        }

        if (a.headers.length !== b.headers.length || a.rows.length !== b.rows.length
            || a.aligns.length !== b.aligns.length) {
            return false;
        }

        for (let i: number = 0; i < a.headers.length; i++) {
            if (!ChatItemBuilder.sameInline(a.headers[i], b.headers[i])) {
                return false;
            }
        }

        for (let r: number = 0; r < a.rows.length; r++) {
            if (a.rows[r].length !== b.rows[r].length) {
                return false;
            }

            for (let c: number = 0; c < a.rows[r].length; c++) {
                if (!ChatItemBuilder.sameInline(a.rows[r][c], b.rows[r][c])) {
                    return false;
                }
            }
        }

        for (let i: number = 0; i < a.aligns.length; i++) {
            if (a.aligns[i] !== b.aligns[i]) {
                return false;
            }
        }

        return true;
    }
}
