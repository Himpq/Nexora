/**
 * conversations.ts — 会话与消息 API
 *
 * 职责:
 *   - 会话列表 / 创建 / 删除
 *   - 会话消息分页读取
 */

import { apiFetch } from './client'
import type { MessageSegment } from '@/stream/messageSegments'

/** 会话分支信息(对齐原版 readConversationBranch 读取的后端 branch 结构) */
export interface ConversationBranch {
    root_conversation_id: string
    parent_conversation_id: string
    parent_message_index: number
    created_at?: string
}

export interface ConversationSummary {
    id: string
    title: string
    conversation_mode?: string
    updated_at?: number
    created_at?: number
    /** 分支会话来源信息(非分支会话为 undefined) */
    branch?: ConversationBranch
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
    status?: 'completed' | 'partial' | 'error' | 'streaming'
    pending?: boolean
    model?: { name?: string; provider?: string }
    summary?: string
    usage?: Record<string, number>
    trace?: {
        events?: Array<Record<string, unknown>>
        tool_calls?: Array<Record<string, unknown>>
        tool_results?: Array<Record<string, unknown>>
        content_segments?: Array<Record<string, unknown>>
        errors?: Array<Record<string, unknown>>
        [key: string]: unknown
    }
    error?: Record<string, unknown>
    versions?: Array<Record<string, unknown>>
    attachments?: Array<Record<string, unknown>>
    metadata?: Record<string, unknown>
    /** 内容分段(思考/正文按输出顺序);流式期间为交错结构,收尾/历史加载后为规范结构 */
    segments?: MessageSegment[]
    model_name?: string
    created_at?: number
    [key: string]: unknown
}

export interface ConversationContextEvent {
    scope: 'workspace' | 'global'
    added?: Array<Record<string, unknown>> | string[]
    removed?: Array<Record<string, unknown>> | string[]
    effective_from_message: number
    hash?: string
    prev_hash?: string
    created_at?: string
    documents_snapshot?: Array<Record<string, unknown>>
    titles_snapshot?: string[]
    [key: string]: unknown
}

interface ConversationCreateResponse {
    success: boolean
    conversation_id: string
    title: string
    existed?: boolean
}

/**
 * 消息窗口初始/向前分页大小(对齐原版 CONVERSATION_INITIAL_MESSAGE_LIMIT /
 * CONVERSATION_PREVIOUS_MESSAGE_LIMIT):初始只拉最近若干轮,更早的在滚动或
 * 跳转时按需补载,避免长对话首屏一次拉取过多。
 * 1 轮 = 用户消息 + 助手消息两条,故轮数乘 2 转为消息条数。
 */
export const INITIAL_TURN_LIMIT = 10
export const INITIAL_MESSAGE_LIMIT = INITIAL_TURN_LIMIT * 2
export const PREVIOUS_MESSAGE_LIMIT = 30

/** 轮次指示器条目(服务端 /turns 归一化后的形状,仅含用户轮次) */
export interface ConversationTurn {
    index: number
    role: 'user'
    content: string
}

export interface MessagesResponse {
    success: boolean
    messages: ChatMessage[]
    context_events?: ConversationContextEvent[]
    start_index: number
    end_index: number
    total: number
    has_more_before?: boolean
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
        // 分支信息必须透传,否则侧边栏无法渲染分支树/右键无法跳转分支处
        branch: readConversationBranch(item),
    }))
}

/** 归一化分支信息:结构不完整时返回 undefined(对齐原版 readConversationBranch) */
function readConversationBranch(item: RawConversationItem): ConversationBranch | undefined {
    const raw = item.branch && typeof item.branch === 'object' ? item.branch as Record<string, unknown> : null

    if (!raw) {
        return undefined
    }

    const rootConversationId = String(raw.root_conversation_id || '').trim()
    const parentConversationId = String(raw.parent_conversation_id || '').trim()
    const parentMessageIndex = Number(raw.parent_message_index)

    if (!rootConversationId || !parentConversationId || !Number.isInteger(parentMessageIndex)) {
        return undefined
    }

    return {
        root_conversation_id: rootConversationId,
        parent_conversation_id: parentConversationId,
        parent_message_index: parentMessageIndex,
        created_at: String(raw.created_at || '').trim(),
    }
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

interface ForkConversationResponse {
    success: boolean
    conversation_id: string
    title: string
    branch: ConversationBranch
}

/** 从已完成的 assistant 回答节点创建独立会话分支(对齐原版 forkFromMessage) */
export async function forkConversation(conversationId: string, messageIndex: number): Promise<ForkConversationResponse> {
    return apiFetch<ForkConversationResponse>(
        `/api/conversations/${encodeURIComponent(conversationId)}/fork`,
        {
            method: 'POST',
            body: JSON.stringify({ message_index: Number(messageIndex) }),
        }
    )
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

/** 切换助手消息到指定历史版本(POST /api/switch_version,对齐原版 switchVersion) */
export async function switchMessageVersion(
    conversationId: string,
    messageIndex: number,
    versionIndex: number,
): Promise<Record<string, unknown> | null> {
    const data = await apiFetch<{ success: boolean; message?: Record<string, unknown> }>('/api/switch_version', {
        method: 'POST',
        body: JSON.stringify({
            conversation_id: conversationId,
            message_index: Number(messageIndex),
            version_index: Number(versionIndex),
        }),
    })

    return data && data.message && typeof data.message === 'object' ? data.message : null
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

/**
 * 拉取会话完整用户轮次列表(对齐原版 /turns 单独获取):
 * 与窗口化消息解耦,使轮次指示器在消息仅加载部分窗口时仍保持完整。
 * 服务端返回条目映射为 { index, role, content } 以复用消息类型。
 */
export async function fetchTurns(conversationId: string): Promise<ConversationTurn[]> {
    const data = await apiFetch<{ success: boolean; turns?: unknown[] }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/turns`
    )

    const rawTurns = Array.isArray(data.turns) ? data.turns : []

    return rawTurns
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
            index: Number(item.message_index),
            role: 'user' as const,
            content: String(item.content || ''),
        }))
}
