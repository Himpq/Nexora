/**
 * messageSegments.ts — 助手消息内容分段模型
 *
 * 职责:
 *   - 以"分段数组"描述一条助手消息:思考(reasoning)、正文(content)、
 *     工具调用(function_call)、工具结果(function_result)按真实输出顺序排列
 *   - 流式增量按类型续写末尾同类型分段,类型切换时新开分段(顺序 append 结构)
 *   - 与扁平字段(content / reasoning / metadata.reasoning_content)互转,保证持久化兼容
 *   - 历史回放/终帧优先从 v4 trace.events 重建完整时序(含工具链),
 *     再读取旧 metadata.process_steps，最后回退扁平字段
 *
 * 背景:
 *   后端持久化的思考内容是整轮累积的单个字符串(metadata.reasoning_content),
 *   但流式过程中思考、正文与工具调用多轮交错(思考 → 正文 → 工具 → 思考 → …);
 *   分段结构保住交错的时序,收尾/历史加载时按 process_steps 还原。
 */

import type { ChatMessage } from '@/api/conversations'
import type { QuestionPayload } from '@/stream/questionCard'

/** 分段类型:思考过程 / 正文 / 工具调用 / 工具结果 / 交互问题 / 终态错误 */
export type MessageSegmentType = 'reasoning' | 'content' | 'function_call' | 'function_result' | 'question' | 'error'

/** 消息内容分段(渲染按数组顺序进行,文本追加只发生在末尾同类型分段) */
export interface MessageSegment {
    type: MessageSegmentType
    /** reasoning/content 为文本;function_call 存参数 JSON,function_result 存结果文本;question 恒为空串 */
    text: string
    /** 工具分段专用:工具名 */
    name?: string
    /** 工具分段专用:调用 ID(配对 call/result) */
    callId?: string
    /** 工具分段专用:模型可见结果(对齐原版 model_visible_result) */
    modelVisibleResult?: string
    /** 工具分段专用:前端优先展示结果(双轨：缓存截胡时展示真实列表) */
    displayResult?: string
    /** 工具分段专用:所属工具轮次(对齐 process_steps.round) */
    round?: number
    /** question 分段专用:问题载荷(question_title/content/choices/allow_other/permission_request 等) */
    question?: QuestionPayload
}

/** 读取消息的扁平思考内容:流式期间写入顶层 reasoning,持久化消息存于 metadata.reasoning_content */
export function readFlatReasoning(message: ChatMessage): string {
    if (typeof message.reasoning === 'string' && message.reasoning) {
        return message.reasoning
    }

    const metadata = (message.metadata && typeof message.metadata === 'object')
        ? message.metadata as Record<string, unknown>
        : {}
    const persisted = metadata.reasoning_content

    return typeof persisted === 'string' ? persisted : ''
}

/**
 * 向消息末尾追加指定类型的增量文本:
 * 末尾分段同类型则续写,类型切换则新开分段(实现思考/正文交错的顺序结构);
 * 每次追加后同步扁平字段 content / reasoning,兼容复制、终帧覆盖等既有逻辑。
 */
export function appendSegmentDelta(message: ChatMessage | undefined, type: MessageSegmentType, delta: string): void {
    if (!message || !delta) {
        return
    }

    const segments = Array.isArray(message.segments) ? message.segments : []
    const last = segments.length > 0 ? segments[segments.length - 1] : undefined

    if (last && last.type === type) {
        last.text += delta
    } else {
        segments.push({ type, text: delta })
    }

    message.segments = segments

    syncFlatFields(message)
}

/** 追加一个工具/问题事件分段(function_call / function_result / question 各占一段,保持真实时序) */
export function appendToolSegment(message: ChatMessage | undefined, segment: MessageSegment): void {
    if (!message || (segment.type !== 'function_call' && segment.type !== 'function_result' && segment.type !== 'question')) {
        return
    }

    const segments = Array.isArray(message.segments) ? message.segments : []

    segments.push(segment)

    message.segments = segments
}

/**
 * 用持久化数据重建分段:
 * 优先 v4 trace.events(完整时序,含工具链与多轮思考)，兼容旧 trace 数组和
 * metadata.process_steps；没有任何事件时才回退扁平字段。
 */
export function rebuildSegmentsForMessage(message: ChatMessage): void {
    if (message.role !== 'assistant') {
        return
    }

    const steps = readProcessSteps(message)

    if (steps.length > 0) {
        const segments = steps
            .map(stepToSegment)
            .filter((segment): segment is MessageSegment => segment !== null)

        message.segments = segments

        syncFlatFields(message)

        return
    }

    rebuildSegmentsFromFlat(message)
}

/**
 * 用扁平字段重建分段(流式中断且无服务端数据时的兜底形态):
 * 得到规范的 [思考…][正文…] 结构,与持久化数据形态一致。
 */
export function rebuildSegmentsFromFlat(message: ChatMessage): void {
    if (message.role !== 'assistant') {
        return
    }

    const segments: MessageSegment[] = []
    const reasoning = readFlatReasoning(message)
    const content = String(message.content || '')

    if (reasoning) {
        segments.push({ type: 'reasoning', text: reasoning })
    }

    if (content) {
        segments.push({ type: 'content', text: content })
    }

    message.segments = segments
}

/** 将分段按类型合并写回扁平字段 content / reasoning(工具分段不参与扁平字段,错误文本并入 content 保持复制/版本数据口径) */
export function flattenSegmentsToFlat(message: ChatMessage): void {
    const segments = Array.isArray(message.segments) ? message.segments : []
    let reasoning = ''
    let content = ''

    segments.forEach((segment) => {
        if (segment.type === 'reasoning') {
            reasoning += segment.text
        } else if (segment.type === 'content' || segment.type === 'error') {
            content += segment.text
        }
    })

    message.reasoning = reasoning
    message.content = content
}

/** 读取 v4 有序 trace.events，并兼容历史 trace 数组与 metadata.process_steps。 */
function readProcessSteps(message: ChatMessage): Array<Record<string, unknown>> {
    const trace = (message.trace && typeof message.trace === 'object')
        ? message.trace as Record<string, unknown>
        : {}
    const events = trace.events

    if (Array.isArray(events) && events.length > 0) {
        return events
            .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object')
            .slice()
            .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
    }

    const metadata = (message.metadata && typeof message.metadata === 'object')
        ? message.metadata as Record<string, unknown>
        : {}
    const raw = metadata.process_steps

    if (Array.isArray(raw)) {
        return raw.filter((step): step is Record<string, unknown> => !!step && typeof step === 'object')
    }

    const steps: Array<Record<string, unknown>> = []
    const appendTraceList = (key: string, type?: string): void => {
        const values = Array.isArray(trace[key]) ? trace[key] : []

        values.forEach((step) => {
            if (step && typeof step === 'object') {
                steps.push({ ...(type ? { type } : {}), ...(step as Record<string, unknown>) })
            }
        })
    }

    appendTraceList('content_segments')
    appendTraceList('tool_calls', 'function_call')
    appendTraceList('tool_results', 'function_result')
    appendTraceList('errors', 'error')

    return steps
}

/** 单条 process_step → 分段(识别文本/工具三类与 question;web_search 等由各自卡片渲染) */
function stepToSegment(step: Record<string, unknown>): MessageSegment | null {
    const type = String(step.type || '').trim()

    if (type === 'reasoning_content') {
        return { type: 'reasoning', text: String(step.content || '') }
    }

    if (type === 'content') {
        return { type: 'content', text: String(step.content || '') }
    }

    if (type === 'function_call') {
        return {
            type: 'function_call',
            text: String(step.arguments || ''),
            name: String(step.name || '').trim() || 'tool',
            callId: String(step.call_id || ''),
            round: Number(step.round) || undefined,
        }
    }

    if (type === 'function_result') {
        const displayCand = (typeof step.display_model_visible_result === 'string' && step.display_model_visible_result.trim())
            ? String(step.display_model_visible_result)
            : (typeof step.display_result === 'string' && step.display_result.trim() ? String(step.display_result) : undefined)
        const modelVis = typeof step.model_visible_result === 'string' ? step.model_visible_result : undefined
        return {
            type: 'function_result',
            text: String(step.result ?? ''),
            name: String(step.name || '').trim() || 'tool',
            callId: String(step.call_id || ''),
            modelVisibleResult: modelVis,
            displayResult: displayCand,
            round: Number(step.round) || undefined,
        }
    }

    // 终态错误步骤(模型限流/认证失败/网络中断等):映射为 error 分段,渲染为消息内红色错误行。
    // 若在此丢弃,纯错误消息重建分段后会被清空(字数归零),前端只剩 toast 而无气泡内容。
    if (type === 'error') {
        return {
            type: 'error',
            text: String(step.content || step.message || ''),
            name: String(step.name || '').trim() || 'error',
            callId: String(step.call_id || ''),
        }
    }

    if (type === 'question') {
        const payload = (step.question && typeof step.question === 'object')
            ? step.question as QuestionPayload
            : {}

        return {
            type: 'question',
            text: '',
            name: 'question',
            callId: String(step.call_id || ''),
            question: payload,
        }
    }

    return null
}

/** 分段变更后同步扁平字段(内部复用扁平化实现,保证单一数据口径) */
function syncFlatFields(message: ChatMessage): void {
    flattenSegmentsToFlat(message)
}
