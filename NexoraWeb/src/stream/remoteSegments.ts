/**
 * 远程任务 → ChatMessage 映射层
 *
 * 目的：让 Projects 面板直接复用 MessageItem 的既有渲染（工具执行卡片、
 * thinking 折叠、token 徽标、提问卡），而不是再手搓一套纯文本渲染。
 *
 * 电脑端 AgentLoop 的事件类型与 MessageSegmentType 天然一一对应：
 *   content            → content
 *   reasoning_content  → reasoning
 *   function_call      → function_call
 *   function_result    → function_result
 *   question           → question
 *   error              → error
 *   context_compression_status / token_usage 不进 segments，
 *   分别落到 message.notice 与 message.io_tokens_cumulative。
 */

import type { ChatMessage } from '@/api/conversations'
import type { RemoteChatMessage, RemoteQuestion, RemoteTaskEvent } from '@/api/nexoracode'
import { rebuildSegmentsForMessage, type MessageSegment } from '@/stream/messageSegments'

/** 压缩状态等非正文事件，统一挂在这里由面板渲染成提示条。 */
export interface RemoteTaskNotice {
    kind: 'context_compression'
    status: string
    content: string
    forced: boolean
    historyCutIndex?: number
    contextWindow?: number
    rawInputTokens?: number
}

function toText(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }

    if (value === null || value === undefined) {
        return ''
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }

    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

function toQuestion(raw: RemoteQuestion | undefined): MessageSegment['question'] {
    if (!raw) {
        return undefined
    }

    return {
        question_title: raw.question_title,
        question_content: raw.question_content,
        choices: raw.choices,
        allow_other: raw.allow_other,
        permission_request: raw.permission_request ?? null,
    }
}

/**
 * 是否「只有工具步骤、没有正文」的 assistant 轮。
 */
function isToolOnlyAssistant(message: ChatMessage): boolean {
    if (message.role !== 'assistant') {
        return false
    }

    const segments = Array.isArray(message.segments) ? message.segments : []
    const hasToolStep = segments.some(item => item.type === 'function_call' || item.type === 'function_result')
    const hasContent = segments.some(item => item.type === 'content' && String(item.text || '').trim())

    return hasToolStep && !hasContent
}

/**
 * 把连续的无正文工具轮并进下一条有正文的 assistant。
 *
 * 电脑端 AgentLoop 每个工具轮单独落盘成一条 assistant 消息（无正文、只含工具步骤），
 * 逐条渲染会在 .message 之间留出 24px 间隔，看起来像凭空多出一节。
 * 口径与原版 chat_messages.js 的 mergeToolOnlyAssistantRows 一致：
 *   - 工具轮只并入 assistant，不并入 user/其他角色；
 *   - 遇到非 assistant 时先把 pending 单独落一条，保持消息顺序；
 *   - 请求以工具轮收尾（权限弹卡中断等）时，pending 也单独成条，不丢步骤。
 */
function mergeToolOnlyAssistantRows(messages: ChatMessage[]): ChatMessage[] {
    const merged: ChatMessage[] = []
    let pendingSegments: MessageSegment[] = []

    const flushPending = (): void => {
        if (!pendingSegments.length) {
            return
        }

        merged.push({
            index: merged.length,
            role: 'assistant',
            content: '',
            status: 'completed',
            segments: pendingSegments,
        })
        pendingSegments = []
    }

    for (const message of messages) {
        if (isToolOnlyAssistant(message)) {
            pendingSegments = pendingSegments.concat(message.segments || [])

            continue
        }

        if (pendingSegments.length && message.role === 'assistant') {
            message.segments = pendingSegments.concat(message.segments || [])
            pendingSegments = []
            // 合并后 token 徽标取后一条（它的 io_tokens 才是这一轮之后的累计值）。
            merged.push(message)

            continue
        }

        flushPending()
        merged.push(message)
    }

    flushPending()

    return merged.map((message, index) => ({ ...message, index }))
}

/**
 * 电脑侧历史消息 → ChatMessage。
 *
 * 电脑端已经把工具调用与工具结果归一化进 assistant 的 metadata.process_steps，
 * 并且不再单独返回 role=tool 行（见 NexoraCode/model/Routes.py 的
 * _normalize_history_messages），所以这里只需按云端历史的口径建好 segments，
 * 再把逐工具轮落盘的消息合并回一轮，剩下交给 MessageItem。
 */
export function remoteHistoryToMessages(rows: RemoteChatMessage[]): ChatMessage[] {
    const messages: ChatMessage[] = []

    for (const row of rows || []) {
        const role = String(row?.role || '')
        const message: ChatMessage = {
            index: messages.length,
            role: role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'user',
            content: toText(row.content),
            status: 'completed',
            created_at: row.timestamp ? Date.parse(String(row.timestamp).replace(' ', 'T')) : undefined,
        }

        if (row.metadata && typeof row.metadata === 'object') {
            message.metadata = row.metadata as Record<string, unknown>
        }

        // assistant 的正文与工具卡都挂在 segments 上,只填 content 会渲染成空消息。
        rebuildSegmentsForMessage(message)
        messages.push(message)
    }

    return mergeToolOnlyAssistantRows(messages)
}

/** 新建一条已落定的 user 消息。
 *  电脑端要等任务跑完才会把这条写进自己的历史，Web 侧先本地补上，
 *  否则对话里只剩助手回复，看不到自己刚下发的内容。 */
export function createRemoteUserMessage(index: number, content: string): ChatMessage {
    return {
        index,
        role: 'user',
        content,
        status: 'completed',
    }
}

/** 新建一条正在生成的 assistant 消息。 */
export function createStreamingAssistant(index: number): ChatMessage {
    return {
        index,
        role: 'assistant',
        content: '',
        status: 'streaming',
        pending: true,
        segments: [],
    }
}

/**
 * 把一条远程事件应用到消息上。
 * 返回 true 表示该事件改变了 segments，调用方据此决定是否重渲染。
 */
export function applyRemoteEvent(
    message: ChatMessage,
    event: RemoteTaskEvent,
    notices: RemoteTaskNotice[]
): boolean {
    const segments = Array.isArray(message.segments) ? message.segments : []

    switch (event.type) {
        case 'content': {
            const delta = String(event.content || '')

            if (!delta) {
                return false
            }

            const last = segments[segments.length - 1]

            if (last && last.type === 'content') {
                last.text += delta
            } else {
                segments.push({ type: 'content', text: delta })
            }

            message.segments = segments
            message.content = segments.filter(s => s.type === 'content').map(s => s.text).join('')

            return true
        }

        case 'reasoning_content': {
            const delta = String(event.content || '')

            if (!delta) {
                return false
            }

            const last = segments[segments.length - 1]

            if (last && last.type === 'reasoning') {
                last.text += delta
            } else {
                segments.push({ type: 'reasoning', text: delta })
            }

            message.segments = segments

            return true
        }

        case 'function_call':
            segments.push({
                type: 'function_call',
                text: String(event.arguments || ''),
                name: String(event.name || ''),
                callId: String(event.call_id || ''),
            })
            message.segments = segments

            return true

        case 'function_result':
            segments.push({
                type: 'function_result',
                text: toText(event.result),
                name: String(event.name || ''),
                callId: String(event.call_id || ''),
                modelVisibleResult: toText(event.result),
            })
            message.segments = segments

            return true

        case 'question':
            segments.push({
                type: 'question',
                text: String(event.question?.question_content || ''),
                question: toQuestion(event.question),
            })
            message.segments = segments

            return true

        case 'error':
            segments.push({ type: 'error', text: String(event.message || '') })
            message.segments = segments

            return true

        case 'token_usage': {
            // 电脑侧给的是本轮窗口口径，累加值由面板按轮次自行累计。
            message.io_tokens_window = {
                input: Number(event.input_tokens) || 0,
                output: Number(event.output_tokens) || 0,
                raw_input: Number(event.raw_input_tokens) || 0,
                cached_input: Number(event.cached_input_tokens) || 0,
            }

            return true
        }

        case 'context_compression_status': {
            notices.push({
                kind: 'context_compression',
                status: String(event.status || ''),
                content: String(event.content || ''),
                forced: event.forced === true,
                historyCutIndex: event.history_cut_index,
                contextWindow: event.context_window,
                rawInputTokens: event.raw_input_tokens,
            })

            return false
        }

        default:
            return false
    }
}

/** 事件流结束后收尾：正文落定、去掉 pending，工具结果按轮次归档。 */
export function finalizeStreamingMessage(message: ChatMessage): void {
    message.status = 'completed'
    message.pending = false
    message.segments = (message.segments || []).filter(segment => segment.text !== '')
}
