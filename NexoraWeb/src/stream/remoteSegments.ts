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
import type { MessageSegment } from '@/stream/messageSegments'

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

/** 电脑侧历史消息 → ChatMessage。tool 消息并入其上一条 assistant 的 segments。 */
export function remoteHistoryToMessages(rows: RemoteChatMessage[]): ChatMessage[] {
    const messages: ChatMessage[] = []
    let index = 0

    for (const row of rows || []) {
        const role = String(row?.role || '')

        if (role === 'tool') {
            // 工具结果紧跟在那次工具调用之后，MessageItem 只渲染 assistant 消息。
            const host = messages[messages.length - 1]

            if (host && host.role === 'assistant') {
                host.segments = (host.segments || []).concat({
                    type: 'function_result',
                    text: toText(row.content),
                    callId: String((row as unknown as Record<string, unknown>).tool_call_id || ''),
                })
            }

            continue
        }

        const message: ChatMessage = {
            index: index++,
            role: role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'user',
            content: toText(row.content),
            status: 'completed',
            created_at: row.timestamp ? Date.parse(String(row.timestamp).replace(' ', 'T')) : undefined,
        }

        if (row.metadata && typeof row.metadata === 'object') {
            message.metadata = row.metadata as Record<string, unknown>
        }

        messages.push(message)
    }

    return messages
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
