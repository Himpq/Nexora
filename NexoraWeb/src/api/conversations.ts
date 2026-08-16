/**
 * conversations.ts — 会话与消息 API
 *
 * 职责:
 *   - 会话列表 / 创建 / 删除
 *   - 会话消息分页读取
 */

import { apiFetch } from './client'

export interface ConversationSummary {
    id: string
    title: string
    conversation_mode?: string
    updated_at?: number
    created_at?: number
    [key: string]: unknown
}

/** 后端会话条目原始结构(字段为 conversation_id,前端统一映射为 id) */
interface RawConversationItem {
    conversation_id?: string
    title?: string
    conversation_mode?: string
    updated_at?: number
    created_at?: number
    [key: string]: unknown
}

export interface ChatMessage {
    index: number
    role: 'user' | 'assistant' | 'system'
    content: string
    reasoning?: string
    model_name?: string
    created_at?: number
    [key: string]: unknown
}

interface ConversationCreateResponse {
    success: boolean
    conversation_id: string
    title: string
    existed?: boolean
}

interface MessagesResponse {
    success: boolean
    messages: ChatMessage[]
    start_index: number
    end_index: number
    total: number
}

/** 获取会话列表(按更新时间倒序);后端字段 conversation_id 映射为前端 id */
export async function listConversations(): Promise<ConversationSummary[]> {
    const data = await apiFetch<{ success: boolean; conversations: RawConversationItem[] }>('/api/conversations')

    if (!Array.isArray(data.conversations)) {
        return []
    }

    return data.conversations.map((item) => ({
        id: String(item.conversation_id || ''),
        title: String(item.title || '新对话'),
        conversation_mode: item.conversation_mode,
        updated_at: item.updated_at,
        created_at: item.created_at,
        // 置顶状态必须透传,否则前端无法排序/显示 pin 图标(后端已按 pin 排序)
        pin: !!item.pin,
    }))
}

/** 创建新会话;传入 conversationId 可复用已存在会话 */
export async function createConversation(options: {
    title?: string
    conversationId?: string
} = {}): Promise<ConversationCreateResponse> {
    return apiFetch<ConversationCreateResponse>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
            title: options.title || '新对话',
            conversation_id: options.conversationId || undefined,
        }),
    })
}

/** 删除会话 */
export async function deleteConversation(conversationId: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
    })
}

/** 置顶/取消置顶会话 */
export async function setConversationPin(conversationId: string, pin: boolean): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}/pin`, {
        method: 'PUT',
        body: JSON.stringify({ pin: !!pin }),
    })
}

/** 修改会话标题 */
export async function updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}/title`, {
        method: 'PUT',
        body: JSON.stringify({ title: String(title || '').trim() }),
    })
}

/** 删除单条消息(按消息索引) */
export async function deleteMessage(conversationId: string, messageIndex: number): Promise<void> {
    await apiFetch<{ success: boolean }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages/${Number(messageIndex)}`,
        { method: 'DELETE' }
    )
}

/** 编辑用户消息内容(PUT) */
export async function updateMessageContent(conversationId: string, messageIndex: number, content: string): Promise<void> {
    await apiFetch<{ success: boolean }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages/${Number(messageIndex)}/content`,
        {
            method: 'PUT',
            body: JSON.stringify({ content: String(content || '') }),
        }
    )
}

/** 分页读取会话消息(倒序分页:before 为读取到哪条索引之前) */
export async function fetchMessages(conversationId: string, options: {
    limit?: number
    before?: number
} = {}): Promise<MessagesResponse> {
    const params = new URLSearchParams()

    if (options.limit) {
        params.set('limit', String(options.limit))
    }

    if (typeof options.before === 'number') {
        params.set('before', String(options.before))
    }

    const query = params.toString()

    return apiFetch<MessagesResponse>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages${query ? `?${query}` : ''}`
    )
}
