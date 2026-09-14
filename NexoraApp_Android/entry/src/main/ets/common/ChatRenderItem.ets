// ChatRenderItem.ets - 聊天列表的块级渲染单元
//
// 一条助手回复实测可达 3394vp（约 4 个屏幕），而用户消息只有 67~267vp ——
// 把整条消息当成一个 ListItem 时，列表行高跨度达 50 倍：
// LazyForEach 对未测量行只能按平均值估算，误差动辄数百 vp，行被真正测量时
// 列表必须整体修正一次，这就是滚动中可见的一帧跳变；同时每新建一行都要
// 布局绘制一整棵上千节点的 markdown 子树（滚动掉帧）。
//
// 这里按 Markdown AST 把助手消息拆成多个渲染单元：一个段落 / 一个代码块 / 一张表
// 各占一个单元，一条消息因此由「一个庞然大物」变成「十几个几十到两三百 vp 的小行」，
// 行高跨度被物理抹平，估算误差与单帧渲染量同步下降。
// 用户消息本身很短且气泡有独立的圆角与对齐，整体保留为一个单元。

import { ChatMessage, TokenUsage, ToolCallItem } from './ChatTypes';
import { InlinePiece, MarkdownBlock } from './MarkdownParser';
import { QuestionItem } from './QuestionLocks';

// 行身份的流式标记：'#1' = 该行仍在流式输出（行内子组件默认展开），
// '#0' = 历史行（默认折叠）。生产端（expansionIdentity）与消费端共用，
// 避免同一串字面量散落在各处
export const ROW_STREAMING_MARK: string = '#1';
export const ROW_HISTORY_MARK: string = '#0';

export enum ChatItemKind {
    USER_MESSAGE = 0,
    ASSISTANT_AVATAR = 1,
    REASONING = 2,
    TOOL_CALL = 3,
    QUESTION = 4,
    CONTENT_BLOCK = 5,
    SEGMENT_ERROR = 6,
    STREAMING_DOTS = 7,
    ERROR_LINE = 8,
    USAGE = 9,
    ACTIONS = 10
}

// 单个 markdown 块的持有者。块内容会在流式期间被替换，而 ChatItemRow 只观察
// ChatRenderItem 这一层，观察不到更深字段的变化；把块单独包一层 @Observed，
// 由块视图直接观察它，就能做到「只有真正变化的那一块重渲染」
@Observed
export class MarkdownBlockHolder {
    // 诊断探针：对象号。父（ChatRenderItem.blockHolder）与子（MarkdownBlockView.holder）
    // 两侧同时打出它，即可判定二者是不是同一个对象
    static seq: number = 0;
    id: number = 0;
    block: MarkdownBlock;
    // 同一块被切成多片（表格 / 代码块）时共用的横向偏移键（空串表示该块不参与横向同步）。
    // 切片后每片都有自己的横向 Scroll，不共享偏移的话横拖只会带动手指下的那一片
    sliceSyncKey: string = '';

    constructor(block: MarkdownBlock) {
        MarkdownBlockHolder.seq += 1;
        this.id = MarkdownBlockHolder.seq;
        this.block = block;
    }
}

@Observed
export class ChatRenderItem {
    // 所属消息。用户消息整条一个单元，需要它直接渲染气泡
    message: ChatMessage;
    kind: ChatItemKind;
    // 单元在消息内的序号：与 message.uid 组成列表键。
    // 刻意不保存消息索引 —— 历史前插会让所有消息索引位移，存索引意味着一整批单元都要改
    order: number;
    // 消息的首 / 末单元：首单元给消息间留白，末单元用于滚动定位收尾
    firstOfMessage: boolean = false;
    lastOfMessage: boolean = false;
    // 轮次跳转高亮：只有被高亮的消息的那些单元为 true。
    // 放在单元上而不是页面 @State：LazyForEach 的项生成器不会因为页面状态变化而重跑，
    // 页面级的下标比较根本不会让已创建的行重新渲染
    highlighted: boolean = false;
    // 仅 CONTENT_BLOCK 使用
    blockHolder: MarkdownBlockHolder | null = null;

    // ==== 诊断探针（定位「行渲染了别人的内容」，完成即删）====
    // 返回本单元实际会渲染出来的文本。CONTENT_BLOCK 取块的 inline 文本，
    // 与 key（uid#order）对照即可判断 blockHolder 是不是指向了别的消息的块
    renderText(): string {
        if (this.blockHolder !== null) {
            const b: MarkdownBlock = this.blockHolder.block;
            let out: string = '';

            if (b.type === 'code') {
                out = b.codeText;
            } else if (b.type === 'list') {
                for (let i: number = 0; i < b.items.length; i++) {
                    const pieces: InlinePiece[] = b.items[i].inline;

                    for (let j: number = 0; j < pieces.length; j++) {
                        out += pieces[j].text;
                    }
                }
            } else if (b.type === 'table') {
                out = 'TBL';
            } else {
                for (let i: number = 0; i < b.inline.length; i++) {
                    out += b.inline[i].text;
                }
            }

            return out;
        }

        return this.text;
    }
    // 该单元与其下方单元之间的间距（vp），-1 表示按单元类型走默认规则。
    // 同一个块被切成多行时用它精确控制接缝：列表切片要 Space.xs（列表内部行距就是它），
    // 表格切片要 0（表格内部本无间隙）—— 覆盖错了接缝处就会露出空隙，把整块切成几截
    gapBelow: number = -1;
    // 用户提问的切片总数：0 表示整条气泡一个单元（自适应宽度），
    // >1 表示长提问被按行切成多片（各片固定宽度拼成同一个气泡，见 ChatItemRow.UserBubbleSlice），
    // 配合 order（本片序号）即可推知本片是首片 / 末片
    userSliceTotal: number = 0;
    // 仅 REASONING 使用
    reasoningText: string = '';
    reasoningStreaming: boolean = false;
    reasoningExpanded: boolean = false;
    // 仅 TOOL_CALL / QUESTION 使用
    toolCall: ToolCallItem | null = null;
    question: QuestionItem | null = null;
    // 仅 SEGMENT_ERROR / ERROR_LINE 使用
    text: string = '';
    // 仅 USAGE 使用
    usage: TokenUsage | null = null;
    modelName: string = '';

    constructor(message: ChatMessage, kind: ChatItemKind, order: number) {
        this.message = message;
        this.kind = kind;
        this.order = order;
    }

    // 列表键：消息身份 + 单元序号。跨数据刷新保持稳定，否则流式增量会重建整行
    key(): string {
        return this.message.uid + '#' + this.order;
    }

    // 展开态身份：在行身份上再带流式标记，供行内子组件在「复用取回」时判断是否换了行。
    // @Reusable 复用时不会重跑 aboutToAppear，子组件里由 aboutToAppear 派生的 @State
    // （思考块的展开态）会带着上一行的值 —— 历史行会按流式态渲染成展开，随后才纠正，
    // 行高随之塌陷几百 vp，表现为滚动时内容跳变。
    // 消费端只依据该串本身判断：键变 = 换了行 → 按新行重置；键不变 = 同一行回滚 → 保留用户操作。
    expansionIdentity(): string {
        return this.key() + (this.reasoningStreaming ? ROW_STREAMING_MARK : ROW_HISTORY_MARK);
    }

    // 内容指纹：证明「同一个键是否始终渲染同一段内容」。
    // 只收录决定渲染结果的量（块类型 / 源偏移 / 片段数 / 间距 / 文本长度），
    // 刻意不含对象身份 —— 复用回滚会换对象实例，但内容不变，那不算串台。
    // 用途：同键的两次测量若「指纹相同而高度不同」= 复用行几何未稳定（探针假象）；
    //       指纹不同 = 键真的指向了不同内容（真串台）
    fingerprint(): string {
        const flags: string = (this.firstOfMessage ? 'F' : '-') + (this.lastOfMessage ? 'L' : '-')
            + 'g' + this.gapBelow;

        if (this.blockHolder !== null) {
            const b: MarkdownBlock = this.blockHolder.block;
            const src: number = b.sourceStart === undefined ? -1 : b.sourceStart;

            return 'cb|' + b.type + '|L' + b.level + '|s' + src
                + '|i' + b.inline.length + '|n' + b.items.length + '|t' + (b.table === null ? 0 : 1)
                + '|c' + (b.codeSliceFirst ? 1 : 0) + (b.codeSliceLast ? 1 : 0)
                + (b.textSliceFirst ? 1 : 0) + (b.textSliceLast ? 1 : 0)
                + '|' + flags;
        }

        return 'k' + this.kind + '|x' + this.text.length + '|r' + this.reasoningText.length
            + '|' + flags;
    }
}
