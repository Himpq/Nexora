import type { MessageSegment } from '@/stream/messageSegments'
import type { ToolStageReplySource } from '@/ui/toolStage'

export interface ToolStageReplyPreviewState {
    phase: 'thinking' | 'content' | 'tool' | 'waiting'
    title: string
    text: string
}

/** 按真实输出顺序选择当前阶段,不用整轮扁平字段判断,避免工具后再次思考仍显示旧正文。 */
export function readToolStageReplyPreview(source: ToolStageReplySource): ToolStageReplyPreviewState | null {
    const segments = source.segments
    const latest = segments?.at(-1)

    if (!segments || !latest) {
        return null
    }

    switch (latest.type) {
        case 'reasoning':
            return { phase: 'thinking', title: '正在思考', text: latest.text }

        case 'content':
        case 'error':
            return { phase: 'content', title: '', text: latest.text }

        case 'function_call':
        case 'function_result': {
            const pending = readPendingToolCalls(segments)

            if (pending.length > 0) {
                return { phase: 'tool', title: '正在调用工具', text: pending.map(readToolName).join('\n') }
            }

            return { phase: 'waiting', title: '工具调用完成', text: readToolName(latest) }
        }

        case 'question':
            return { phase: 'waiting', title: '等待你的回答', text: '' }
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

/** 截取有限长度的末尾,保留完整字符,思考和正文共用同一个滑动窗口。 */
export function clipToolStagePreviewText(text: string, length = 480): string {
    let start = Math.max(0, text.length - length)
    const firstCodeUnit = text.charCodeAt(start)

    if (firstCodeUnit >= 0xDC00 && firstCodeUnit <= 0xDFFF) {
        start += 1
    }

    return text.slice(start).trim()
}
