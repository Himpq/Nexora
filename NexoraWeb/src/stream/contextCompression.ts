/**
 * contextCompression.ts — 上下文压缩卡片纯逻辑(协议解析 + 文案格式化)
 *
 * 职责:
 *   - 定义后端 context_compression_status 数据块的结构与解析(纯函数,无 DOM/Vue 依赖)
 *   - 构建卡片触发原因提示与展开正文(对齐原版 chat.js buildContextCompressionTriggerHint /
 *     buildContextCompressionOutputText,并复用 ChatMessage.metadata.process_steps 历史回放)
 *
 * 协议(见 ChatDBServer/api/App/Core/model.py):
 *   status: start | done | skipped
 *   content: 状态标题(如"上下文压缩中(强制)")
 *   trigger_mode: force | overload
 *   raw_input_tokens / post_raw_input_tokens / saved_tokens / saved_ratio
 *   context_window / compression_threshold / masked_image_data_urls
 *   summary_text / summary_chars / history_cut_index
 */

/** 后端 context_compression_status 数据块(字段均可能缺失,读取必须容错) */
export interface ContextCompressionStep {
    type?: string
    status: string
    content?: string
    forced?: boolean
    trigger_mode?: string
    context_window?: number
    context_window_source?: string
    context_window_is_fallback_default?: boolean
    raw_input_tokens?: number
    post_raw_input_tokens?: number
    saved_tokens?: number
    saved_ratio?: number
    compression_threshold?: number
    masked_image_data_urls?: number
    summary_text?: string
    summary_chars?: number
    history_cut_index?: number
}

/** 非负整数化(对齐原版 safeTokenInt:NaN/负数统一归零) */
function safeTokenInt(value: unknown): number {
    const num = Number(value || 0)

    if (!Number.isFinite(num)) {
        return 0
    }

    return Math.max(0, Math.floor(num))
}

/** 兼容异常值:可解析则取整,否则返回 -1(对齐原版 history_cut_index 读取) */
function safeCutIndex(value: unknown): number {
    const num = Number(value)

    return Number.isFinite(num) ? Math.floor(num) : -1
}

/**
 * 解析后端数据块为上下文压缩步骤;非 context_compression_status 或结构非法返回 null。
 * 纯函数,供流式块与历史 process_steps 复用,避免各调用点重复判断。
 */
export function parseContextCompressionStep(raw: unknown): ContextCompressionStep | null {
    if (!raw || typeof raw !== 'object') {
        return null
    }

    const record = raw as Record<string, unknown>

    if (String(record.type || '').trim() !== 'context_compression_status') {
        return null
    }

    const status = String(record.status || '').trim().toLowerCase()

    if (status !== 'start' && status !== 'done' && status !== 'skipped') {
        return null
    }

    return {
        type: 'context_compression_status',
        status,
        content: String(record.content || ''),
        forced: !!record.forced,
        trigger_mode: String(record.trigger_mode || '').trim().toLowerCase(),
        context_window: safeTokenInt(record.context_window),
        context_window_source: String(record.context_window_source || '').trim(),
        context_window_is_fallback_default: !!record.context_window_is_fallback_default,
        raw_input_tokens: safeTokenInt(record.raw_input_tokens),
        post_raw_input_tokens: safeTokenInt(record.post_raw_input_tokens),
        saved_tokens: safeTokenInt(record.saved_tokens),
        saved_ratio: Number(record.saved_ratio) || 0,
        compression_threshold: safeTokenInt(record.compression_threshold),
        masked_image_data_urls: safeTokenInt(record.masked_image_data_urls),
        summary_text: String(record.summary_text || '').trim(),
        summary_chars: safeTokenInt(record.summary_chars),
        history_cut_index: safeCutIndex(record.history_cut_index),
    }
}

/** 从 v4 trace.events 中提取全部上下文压缩步骤，兼容旧 metadata.process_steps。 */
export function contextCompressionStepsFromMetadata(metadata: unknown): ContextCompressionStep[] {
    if (!metadata || typeof metadata !== 'object') {
        return []
    }

    const record = metadata as Record<string, unknown>
    const trace = record.trace && typeof record.trace === 'object'
        ? record.trace as Record<string, unknown>
        : {}
    const steps = Array.isArray(trace.events)
        ? trace.events
        : record.process_steps

    if (!Array.isArray(steps)) {
        return []
    }

    const result: ContextCompressionStep[] = []

    steps.forEach((step) => {
        const parsed = parseContextCompressionStep(step)

        if (parsed) {
            result.push(parsed)
        }
    })

    return result
}

/** 取消息上"当前生效"的压缩步骤:流式本地字段优先,历史回退到 process_steps 最后一条 */
export function resolveActiveContextCompressionStep(
    message: Record<string, unknown> | null | undefined
): ContextCompressionStep | null {
    if (!message) {
        return null
    }

    const live = parseContextCompressionStep(message.compressionStep)

    if (live) {
        return live
    }

    const history = contextCompressionStepsFromMetadata(message)

    return history.length > 0 ? history[history.length - 1] : null
}

/** 触发原因提示行(对齐原版 buildContextCompressionTriggerHint) */
export function buildContextCompressionTriggerHint(step: ContextCompressionStep): string {
    const mode = String(step.trigger_mode || '').trim().toLowerCase()
    const maskedImages = safeTokenInt(step.masked_image_data_urls)
    let hint = ''

    if (mode === 'force') {
        hint = '触发原因：强制触发'
    } else if (mode === 'overload') {
        const raw = safeTokenInt(step.raw_input_tokens)
        const windowSize = safeTokenInt(step.context_window)
        const threshold = safeTokenInt(step.compression_threshold)

        if (raw > 0 && windowSize > 0) {
            hint = `触发原因：上下文过载（${raw.toLocaleString()} / ${windowSize.toLocaleString()}）`

            if (threshold > 0) {
                hint += `，阈值 ${threshold.toLocaleString()}`
            }
        } else {
            hint = '触发原因：上下文过载'
        }
    } else if (step.status === 'skipped') {
        hint = '触发原因：条件不满足'
    }

    if (hint && maskedImages > 0) {
        hint += ` · 图片脱敏 ${Math.max(0, maskedImages)} 张`
    }

    return hint
}

/** 卡片展开正文(对齐原版 buildContextCompressionOutputText) */
export function buildContextCompressionOutputText(step: ContextCompressionStep): string {
    const lines: string[] = []
    const hint = buildContextCompressionTriggerHint(step)

    if (hint) {
        lines.push(hint)
    }

    const rawInput = safeTokenInt(step.raw_input_tokens)
    const postInput = safeTokenInt(step.post_raw_input_tokens)
    const savedTokens = safeTokenInt(step.saved_tokens)
    const savedRatio = Number(step.saved_ratio || 0)
    const windowSize = safeTokenInt(step.context_window)
    const threshold = safeTokenInt(step.compression_threshold)
    const cutIndex = safeCutIndex(step.history_cut_index)
    const summaryChars = safeTokenInt(step.summary_chars)
    const summaryText = String(step.summary_text || '').trim()

    if (rawInput > 0) {
        lines.push(`压缩前输入: ${rawInput.toLocaleString()} tokens`)
    }

    if (windowSize > 0) {
        lines.push(`上下文窗口: ${windowSize.toLocaleString()}`)
    }

    if (threshold > 0) {
        lines.push(`触发阈值: ${threshold.toLocaleString()}`)
    }

    if (postInput > 0) {
        lines.push(`压缩后输入: ${postInput.toLocaleString()} tokens`)
    }

    if (savedTokens > 0) {
        lines.push(`节省: ${savedTokens.toLocaleString()} tokens (${Math.round(Math.max(0, savedRatio) * 100)}%)`)
    }

    if (cutIndex >= 0) {
        lines.push(`历史截断索引: ${cutIndex}`)
    }

    if (summaryChars > 0) {
        lines.push(`摘要长度: ${summaryChars} 字符`)
    }

    if (summaryText) {
        lines.push('')
        lines.push('压缩摘要:')
        lines.push(summaryText)
    } else if (step.status === 'start') {
        lines.push('')
        lines.push('压缩任务已开始，等待模型生成摘要...')
    }

    return lines.join('\n').trim()
}
