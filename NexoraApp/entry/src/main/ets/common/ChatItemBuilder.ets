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
import { Space } from './DesignToken';
import { ChatItemKind, ChatRenderItem, MarkdownBlockHolder } from './ChatRenderItem';

// 列表块每行放多少个条目。
// 理由：列表的内部行距与列表行之间的行距都是 Space.xs(4vp)，按条目分组后视觉完全连续，
// 是唯一可以零代价拆小的块类型。单行的最高高度因此从「整张列表」收敛到「4 个条目」，
// 不再出现 300~500vp 的高行 —— 高行是滚动中位置跳变的来源
// （列表对未测量行按均值估算，行越高、估值偏差越大）。
const LIST_ITEMS_PER_ROW: number = 4;

// 表格每片放多少个数据行。
// 表格数据行约 43vp，而列表对未测量行的估算均值是 87vp —— 每片 2 行（约 90vp）
// 刚好落在均值附近，于是「实际高度 − 行数 × 估算均值」的误差趋近于零。
// 这个误差就是滚动中可见位移的量：整张 7 行表（约 344vp）一次进入时误差约 257vp（小半屏），
// 切成 4 片后每片误差只剩几十 vp。表头只留在第一片，不重复
const TABLE_ROWS_PER_SLICE: number = 2;

// 同一个块被切开后的接缝间距（vp）。
// 列表内部行距就是 Space.xs，表格内部本无间隙 —— 接缝必须与块内部间距一致，
// 否则切开处会露出空隙，看起来像被截断了
const LIST_SLICE_GAP: number = Space.xs;
const TABLE_SLICE_GAP: number = 0;

export class ChatItemBuilder {
    // 展开一条消息。返回顺序即渲染顺序，order 从 0 递增且在一次展开内稳定
    static build(message: ChatMessage): ChatRenderItem[] {
        const items: ChatRenderItem[] = [];

        if (message.isUser) {
            items.push(new ChatRenderItem(message, ChatItemKind.USER_MESSAGE, 0));
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
                const blocks: MarkdownBlock[] = MarkdownParser.parse(segment.text);

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

    // 把一张列表按条目切成多行：每行保留同一个列表的 ordered / 行内样式，
    // 条目自带 marker（有序列表的序号），因此切分不会改变任何显示内容
    private static pushListSlices(items: ChatRenderItem[], message: ChatMessage, order: number,
        block: MarkdownBlock): number {
        let cursor: number = order;

        for (let start: number = 0; start < block.items.length; start += LIST_ITEMS_PER_ROW) {
            const slice: MdListItem[] = block.items.slice(start, start + LIST_ITEMS_PER_ROW);
            const item: ChatRenderItem = new ChatRenderItem(message, ChatItemKind.CONTENT_BLOCK, cursor++);
            item.blockHolder = new MarkdownBlockHolder(ChatItemBuilder.listSlice(block, slice));
            item.gapBelow = start + LIST_ITEMS_PER_ROW < block.items.length ? LIST_SLICE_GAP : -1;
            items.push(item);
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

            holder.tableSyncKey = syncKey;
            item.blockHolder = holder;
            item.gapBelow = last ? -1 : TABLE_SLICE_GAP;
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
