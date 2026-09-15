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
import { MarkdownBlock } from './MarkdownParser';
import { QuestionItem } from './QuestionLocks';

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
    block: MarkdownBlock;
    // 同一张表被切成多片时共用的横向偏移键（空串表示该块不参与横向同步）。
    // 切片后每片都有自己的横向 Scroll，不共享偏移的话横拖只会带动手指下的那一片
    tableSyncKey: string = '';

    constructor(block: MarkdownBlock) {
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
    // 该单元与其下方单元之间的间距（vp），-1 表示按单元类型走默认规则。
    // 同一个块被切成多行时用它精确控制接缝：列表切片要 Space.xs（列表内部行距就是它），
    // 表格切片要 0（表格内部本无间隙）—— 覆盖错了接缝处就会露出空隙，把整块切成几截
    gapBelow: number = -1;
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
}
