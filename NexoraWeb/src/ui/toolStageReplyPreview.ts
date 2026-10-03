import type { MessageSegment } from '@/stream/messageSegments'
import type { ToolStageReplySource } from '@/ui/toolStage'

export interface ToolStageReplyPreviewState {
    phase: 'thinking' | 'content' | 'tool' | 'waiting'
    title: string
    text: string
    completed: boolean
}

/** 按真实输出顺序选择当前阶段,不用整轮扁平字段判断,避免工具后再次思考仍显示旧正文。 */
export function readToolStageReplyPreview(source: ToolStageReplySource): ToolStageReplyPreviewState | null {
    const segments = source.segments
    const latest = segments?.at(-1)

    if (!segments || !latest) {
        return null
    }

    const completed = source.completed === true

    switch (latest.type) {
        case 'reasoning':
            return { phase: 'thinking', title: '正在思考', text: latest.text, completed }

        case 'content':
        case 'error':
            return { phase: 'content', title: '', text: latest.text, completed }

        case 'function_call':
        case 'function_result': {
            const pending = readPendingToolCalls(segments)

            if (pending.length > 0) {
                return { phase: 'tool', title: '正在调用工具', text: pending.map(readToolName).join('\n'), completed }
            }

            return { phase: 'waiting', title: '工具调用完成', text: readToolName(latest), completed }
        }

        case 'question':
            return { phase: 'waiting', title: '等待你的回答', text: '', completed }
    }
}

/** 只配对当前工具阶段的调用与结果,并行工具的结果乱序返回时仍展示尚未完成的调用。 */
function readPendingToolCalls(segments: readonly MessageSegment[]): MessageSegment[] {
    const completed = new Map<string | undefined, number>()
    const pending: MessageSegment[] = []

    for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index]!

        if (segment.type === 'function_result') {
            completed.set(segment.callId, (completed.get(segment.callId) ?? 0) + 1)
        }
        else if (segment.type === 'function_call') {
            const resultCount = completed.get(segment.callId) ?? 0

            if (resultCount > 0) {
                completed.set(segment.callId, resultCount - 1)
            }
            else {
                pending.push(segment)
            }
        }
        else {
            break
        }
    }

    return pending.reverse()
}

/** 工具参数尚未补全时只有调用状态,不把内部占位名或参数 JSON 显示给用户。 */
function readToolName(segment: MessageSegment): string {
    return segment.name && segment.name !== 'tool' ? segment.name : ''
}

/** 流式预览保留末尾;完成态保留开头,避免收缩后露出回复中段。 */
export function clipToolStagePreviewText(text: string, length = 480, fromStart = false): string {

    if (fromStart) {
        let end = Math.min(text.length, length)

        if (end < text.length) {
            const lastCodeUnit = text.charCodeAt(end - 1)
            const nextCodeUnit = text.charCodeAt(end)
            const splitsSurrogatePair = lastCodeUnit >= 0xD800
                && lastCodeUnit <= 0xDBFF
                && nextCodeUnit >= 0xDC00
                && nextCodeUnit <= 0xDFFF

            if (splitsSurrogatePair) {
                end -= 1
            }
        }

        return text.slice(0, end)
    }

    let start = Math.max(0, text.length - length)
    const firstCodeUnit = text.charCodeAt(start)

    if (firstCodeUnit >= 0xDC00 && firstCodeUnit <= 0xDFFF) {
        start += 1
    }

    return text.slice(start).trim()
}
