// ConversationBuffer.ets - 单会话本地消息缓冲
// 多会话并行的核心数据结构：每个会话独立持有消息窗口与向前分页游标。
// 用户切走后，该会话的流继续写入自己的缓冲；切回时原样接上，
// 生成不再因切换会话而中断，进度也不会丢失

import { ChatMessage } from './ChatTypes';

export class ConversationBuffer {
    // 会话消息窗口（含本地乐观消息与流式中的助手消息）
    messages: ChatMessage[] = [];
    // 是否还有更早消息未加载
    hasMore: boolean = false;
    // 当前窗口最早消息的绝对索引（向前分页游标）
    oldestIndex: number = 0;
}
