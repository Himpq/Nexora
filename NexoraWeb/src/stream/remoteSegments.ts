/**
 * 远程任务 → ChatMessage 映射层
 *
 * 目的：让 Projects 面板直接复用 MessageItem 的既有渲染（工具执行卡片、
 * thinking 折叠、token 徽标、提问卡），而不是再手搓一套纯文本渲染。
 *
 * 电脑端 AgentLoop 的事件类型与 MessageSegmentType 天然一一对应：
 *   model_info        → message.model_name
 *   content            → content
 *   reasoning_content  → reasoning
 *   function_call      → function_call
 *   function_result    → function_result
 *   question           → question
 *   error              → error
 *   context_compression_status → compression
 *   context_injection         → injection
 *   token_usage               → message.io_tokens_window
 */

import type { ChatMessage } from '@/api/conversations'
import type { RemoteChatMessage, RemoteQuestion, RemoteTaskEvent } from '@/api/nexoracode'
import { parseContextCompressionStep, type ContextCompressionStep } from '@/stream/contextCompression'
import { parseContextInjectionStep } from '@/stream/contextInjection'
import { appendToolSegment, rebuildSegmentsForMessage, type MessageSegment } from '@/stream/messageSegments'

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
    let pendingIndex: number | null = null

    const flushPending = (): void => {
        if (!pendingSegments.length) {
            return
        }

        merged.push({
            index: pendingIndex ?? merged.length,
            role: 'assistant',
            content: '',
            status: 'completed',
            segments: pendingSegments,
        })
        pendingSegments = []
        pendingIndex = null
    }

    for (const message of messages) {
        if (isToolOnlyAssistant(message)) {
            if (!pendingSegments.length) {
                pendingIndex = message.index
            }

            pendingSegments = pendingSegments.concat(message.segments || [])

            continue
        }

        if (pendingSegments.length && message.role === 'assistant') {
            message.segments = pendingSegments.concat(message.segments || [])
            message.index = pendingIndex ?? message.index
            pendingSegments = []
            pendingIndex = null
            // 合并后 token 徽标取后一条（它的 io_tokens 才是这一轮之后的累计值）。
            merged.push(message)

            continue
        }

        flushPending()
        merged.push(message)
    }

    flushPending()

    return merged
}

/**
 * 电脑侧历史消息 → ChatMessage。
 *
 * 电脑端已经把工具调用与工具结果归一化进 assistant 的 metadata.process_steps，
 * 并且不再单独返回 role=tool 行（见 NexoraCode/model/Routes.py 的
 * _normalize_history_messages），所以这里只需按云端历史的口径建好 segments，
 * 再把逐工具轮落盘的消息合并回一轮，剩下交给 MessageItem。
 */
export function remoteHistoryToMessages(rows: RemoteChatMessage[], startIndex = 0): ChatMessage[] {
    const messages: ChatMessage[] = []

    for (const [offset, row] of (rows || []).entries()) {
        const role = String(row?.role || '')
        const message: ChatMessage = {
            index: startIndex + offset,
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
        outputFinished: false,
        segments: [],
    }
}

/**
 * 队列轮次开始：把上一轮定稿，并追加（或复用）本轮的用户气泡与助手占位。
 *
 * 电脑端队列多轮共用同一条流，靠 queue_turn_start / queue_turn_end 切分气泡。
 * 云端 Remote 主区没有本地 pendingStreams 缓冲，只能在这里按事件重建：
 *   - message 为本轮用户输入（引导消息同样带）；
 *   - user_index / assistant_index 是电脑端落盘后的权威下标，直接采用，
 *     不再本地自增，避免与历史行下标脱锚后 key 复用错位。
 *
 * 幂等性：接管一个已在跑的任务时 restore() 会把游标归零、从头重放整条流，
 * 历史轮次的 queue_turn_start 会被再读一次。此时该轮的用户气泡与助手消息
 * 已经由 loadConversationHistory 落进 messages，无条件 push 会把气泡翻倍。
 * 因此这里按权威下标定位：命中就复用（重置为流式占位），未命中才追加。
 *
 * 返回本轮新的助手占位，供后续事件继续累积。
 */
export function beginRemoteQueuedTurn(
    messages: ChatMessage[],
    event: RemoteTaskEvent,
    fallbackIndex: number,
): ChatMessage {
    const previous = messages[messages.length - 1]

    if (previous?.role === 'assistant' && previous.status === 'streaming') {
        finalizeStreamingMessage(previous)
    }

    const userIndex = Number(event.user_index)
    const assistantIndex = Number(event.assistant_index)
    const resolvedUserIndex = Number.isFinite(userIndex) ? userIndex : fallbackIndex
    const resolvedAssistantIndex = Number.isFinite(assistantIndex) ? assistantIndex : resolvedUserIndex + 1
    const text = String(event.message || '')

    // 重放场景：该轮已经落进 messages，就地复用，不重复追加。
    const existingUser = messages.find(message => message.role === 'user' && Number(message.index) === resolvedUserIndex)

    if (existingUser) {
        if (text) {
            existingUser.content = text
        }
    } else {
        messages.push(createRemoteUserMessage(resolvedUserIndex, text))
    }

    const existingAssistant = messages.find(
        message => message.role === 'assistant' && Number(message.index) === resolvedAssistantIndex
    )

    if (existingAssistant) {
        // 已存在的可能是历史里已定稿的那条；重放时它后面还有新内容，
        // 重置为流式占位让后续事件继续累积。
        existingAssistant.status = 'streaming'
        existingAssistant.pending = true
        existingAssistant.outputFinished = false
        dropOrphanPlaceholder(messages, existingAssistant)

        return existingAssistant
    }

    const assistant = createStreamingAssistant(resolvedAssistantIndex)

    messages.push(assistant)

    return assistant
}

/**
 * 清掉接管时预建的孤儿占位。
 *
 * syncActiveTasks 在 restore() 之前会先用 takeNextMessageIndex 建一条空占位，
 * 而重放的 queue_turn_start 带来的是电脑端落盘后的权威下标，两者可能不同。
 * 权威下标的那条已复用后，这条空占位就是多余的，留着会在对话尾部
 * 多出一个永远不动的空气泡。
 */
function dropOrphanPlaceholder(messages: ChatMessage[], keep: ChatMessage): void {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]

        if (message === keep) {
            continue
        }

        const isPlaceholder = message.role === 'assistant'
            && message.status === 'streaming'
            && String(message.content || '').trim() === ''
            && (message.segments || []).length === 0

        if (isPlaceholder) {
            messages.splice(index, 1)
        }
    }
}

/**
 * 队列轮次结束：用电脑端落盘的最终消息覆盖本轮助手气泡并定稿。
 *
 * 电脑端在 queue_turn_end 里带上该轮已收尾的 assistant 消息（含 metadata
 * 里的 process_steps）。用它重建分段才能保住工具链时序；流式期间累积的
 * 正文在重建后若丢失则回填，避免气泡闪空。
 */
export function applyRemoteFinalMessage(
    message: ChatMessage | null | undefined,
    finalMessage: Record<string, unknown> | null | undefined,
): void {
    if (!message) {
        return
    }

    if (finalMessage && typeof finalMessage === 'object') {
        const incoming = String(finalMessage.content ?? '')

        if (incoming.trim() !== '' || String(message.content || '').trim() === '') {
            message.content = incoming
        }

        if (finalMessage.metadata && typeof finalMessage.metadata === 'object') {
            message.metadata = finalMessage.metadata as Record<string, unknown>
        }

        if (typeof finalMessage.timestamp === 'string' && finalMessage.timestamp) {
            message.timestamp = finalMessage.timestamp
        }

        const v4Fields = ['status', 'model', 'usage', 'io_tokens_window', 'io_tokens_cumulative', 'trace'] as const

        v4Fields.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(finalMessage, key)) {
                ;(message as unknown as Record<string, unknown>)[key] = finalMessage[key]
            }
        })
    }

    const preContent = String(message.content || '')
    const preSegments = Array.isArray(message.segments) ? [...message.segments] : []

    rebuildSegmentsForMessage(message)

    if (String(message.content || '').trim() === '' && preContent.trim() !== '') {
        message.content = preContent

        const hasContentSegment = (message.segments || []).some(
            segment => segment.type === 'content' && String(segment.text || '').trim() !== ''
        )

        if (!hasContentSegment) {
            message.segments = [
                ...(message.segments || []),
                ...preSegments.filter(segment => segment.type === 'content' || segment.type === 'reasoning'),
            ]
        }
    }

    finalizeStreamingMessage(message)
}

/**
 * 合并压缩状态帧。
 *
 * progress 帧只带增量信息，直接覆盖会丢掉 start 帧里的阈值/窗口等关键统计，
 * 因此与已有 start/progress 合并；done/skipped 等终态直接覆盖。
 */
function mergeCompressionStep(
    previous: unknown,
    next: ContextCompressionStep
): ContextCompressionStep {
    const prev = parseContextCompressionStep(previous)

    if (!prev || next.status !== 'progress' || (prev.status !== 'start' && prev.status !== 'progress')) {
        return next
    }

    return {
        ...prev,
        ...next,
        raw_input_tokens: next.raw_input_tokens || prev.raw_input_tokens,
        context_window: next.context_window || prev.context_window,
        compression_threshold: next.compression_threshold || prev.compression_threshold,
        trigger_mode: next.trigger_mode || prev.trigger_mode,
        forced: next.forced || prev.forced,
    }
}

/** 原地更新消息里的压缩/注入卡片分段；没有则追加一段（保持与本地 _upsertCardSegment 同语义）。 */
function upsertRemoteCardSegment(
    message: ChatMessage,
    kind: 'compression' | 'injection',
    rawStep: Record<string, unknown>
): void {
    const segments = Array.isArray(message.segments) ? message.segments : []
    const existing = segments.find(segment => segment.type === kind)

    if (existing) {
        existing.step = rawStep
        message.segments = segments

        return
    }

    appendToolSegment(message, { type: kind, text: '', step: rawStep })
}

/**
 * 把一条远程事件应用到消息上。
 * 返回 true 表示该事件改变了消息展示数据。
 */
export function applyRemoteEvent(
    message: ChatMessage,
    event: RemoteTaskEvent
): boolean {
    const segments = Array.isArray(message.segments) ? message.segments : []

    switch (event.type) {
        case 'model_info': {
            const modelName = String(event.model_name || '').trim()

            if (!modelName) {
                return false
            }

            message.model_name = modelName

            const provider = String(event.provider || '').trim()

            if (provider) {
                message.model = {
                    name: modelName,
                    provider,
                }
            }

            return true
        }

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

        case 'auto_retry': {
            // 电脑端自动重试提示：与本地通道一致，按事件顺序各占一段（不去重），
            // 让用户看到重试了几次。重试不是失败，不并入 error 分段。
            appendToolSegment(message, {
                type: 'auto_retry',
                text: String(event.reason || ''),
                name: 'auto_retry',
                step: event as unknown as Record<string, unknown>,
            })

            return true
        }

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
            // 与本地/云端会话一致：压缩状态写进消息的 compressionStep，由 MessageItem
            // 渲染成一张原地更新的压缩卡片。此前这里是 notices.push，导致每来一条
            // progress 帧就多一行提示，长压缩直接刷屏。
            const parsed = parseContextCompressionStep(event)

            if (!parsed) {
                return false
            }

            message.compressionStep = mergeCompressionStep(message.compressionStep, parsed)
            upsertRemoteCardSegment(message, 'compression', event as unknown as Record<string, unknown>)

            return true
        }

        case 'context_injection': {
            const parsed = parseContextInjectionStep(event)

            if (!parsed) {
                return false
            }

            // 压缩重建后电脑会重发全量注入诊断；更新原卡片，避免同轮重复展示。
            message.injectionStep = parsed
            upsertRemoteCardSegment(message, 'injection', event as unknown as Record<string, unknown>)

            return true
        }

        default:
            return false
    }
}

/** 事件流结束后收尾：标记正文完成、去掉 pending，工具结果按轮次归档。 */
export function finalizeStreamingMessage(message: ChatMessage): void {
    message.status = 'completed'
    message.pending = false
    message.outputFinished = true
    message.segments = (message.segments || []).filter(segment => segment.text !== '')
}
