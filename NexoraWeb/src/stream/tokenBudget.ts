/**
 * tokenBudget.ts — 上下文窗口(Token 预算)卡片纯逻辑(对齐原版 chat.js)
 *
 * 职责:
 *   - 定义上下文窗口归一化 / 本轮真实占用计算(增量口径补全固定部分)
 *   - 构建 Token 预算卡片数据模型(上下文窗口占比 + 构成明细)
 *   - 生成 usage 悬浮提示文本(CTX 占用 / 原始输入 / 缓存 / 构成 / 计费 / 剩余)
 *
 * 数据源(对齐原版 tokenBudgetState):
 *   - contextWindow: 模型配置的上下文窗口
 *   - profile: prompt_token_profile 块(system_tokens / tools_tokens)
 *   - io payload: 最后一条助手消息 metadata.io_tokens_window / io_tokens_cumulative
 *   - roundInput: 本轮真实 usage 缺失时用消息文本估算
 *
 * 全部为纯函数,无 DOM / Vue 依赖,供 ChatInput 卡片与测试复用。
 */

/** io_tokens 消息 metadata(对齐原版 normalizeIoTokensPayload 结构) */
export interface IoTokenPayload {
    input: number
    rawInput: number
    cachedInput: number
    output: number
}

/** 单条消息的 io_tokens:round 为本轮(io_tokens_window 优先),cumulative 为累计(io_tokens_cumulative 优先) */
export interface MessageIoTokens {
    round: IoTokenPayload
    cumulative: IoTokenPayload
}

/** Token 预算卡片数据模型(对齐原版 buildTokenBudgetTooltipModel 返回结构) */
export interface TokenBudgetTooltipModel {
    limit: number
    hasContextWindow: boolean
    used: number
    remain: number
    ratioRaw: number
    contextOn: boolean
    rawInput: number
    totalInput: number
    cumulativeInput: number
    cachedInput: number
    systemTokens: number
    toolTokens: number
    contextTokens: number
    reserveTokens: number
    estimated: boolean
    pct: (n: number) => string
}

/** 非负整数化(对齐原版 safeTokenInt:NaN/负数统一归零) */
export function safeTokenInt(value: unknown): number {
    const num = Number(value || 0)

    if (!Number.isFinite(num)) {
        return 0
    }

    return Math.max(0, Math.floor(num))
}

/**
 * 文本 → token 估算(对齐原版 estimateStreamTokensByText):
 * 非 ASCII 按 1.25 字符/token,ASCII 按 4 字符/token;空文本计 0,非空至少 1。
 * 供 TK mini 流式输出估算与 CTX 文本估算复用。
 */
export function estimateStreamTokensByText(text: unknown): number {
    const source = String(text ?? '')

    if (!source) {
        return 0
    }

    const nonAscii = (source.match(/[^\x00-\x7F]/g) || []).length
    const ascii = source.length - nonAscii

    return Math.max(1, Math.ceil(nonAscii / 1.25 + ascii / 4))
}

/**
 * 归一化上下文窗口:非法/过小(<1024)视为未配置,超大值收敛到 4M(对齐原版 normalizeContextWindow)
 */
export function normalizeContextWindow(value: unknown): number {
    const num = safeTokenInt(value)

    if (num < 1024) {
        return 0
    }

    return Math.min(4000000, num)
}

/**
 * 读取单条消息的 io_tokens metadata(round 优先 io_tokens_window,cumulative 优先 io_tokens_cumulative,
 * 对齐原版 normalizeIoTokensPayload)
 */
export function readMessageIoTokens(metadata: unknown): MessageIoTokens {
    if (!metadata || typeof metadata !== 'object') {
        return { round: emptyIoPayload(), cumulative: emptyIoPayload() }
    }

    const record = metadata as Record<string, unknown>

    return {
        round: readIoPayloadRecord(record.io_tokens_window),
        cumulative: readIoPayloadRecord(record.io_tokens_cumulative || record.io_tokens),
    }
}

/** 读取最后一条带 io_tokens metadata 的助手消息(无则返回空 payload) */
export function readLastAssistantIoTokens(messages: Array<{ role?: string; metadata?: unknown }>): MessageIoTokens {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]

        if (message && message.role === 'assistant' && message.metadata) {
            const tokens = readMessageIoTokens(message.metadata)

            if (hasAnyIo(tokens.round) || hasAnyIo(tokens.cumulative)) {
                return tokens
            }
        }
    }

    return { round: emptyIoPayload(), cumulative: emptyIoPayload() }
}

function emptyIoPayload(): IoTokenPayload {
    return { input: 0, rawInput: 0, cachedInput: 0, output: 0 }
}

function readIoPayloadRecord(raw: unknown): IoTokenPayload {
    if (!raw || typeof raw !== 'object') {
        return emptyIoPayload()
    }

    const record = raw as Record<string, unknown>

    // 后端 metadata 协议为 snake_case(model.py io_tokens_window:raw_input/cached_input),
    // 必须按后端键名读取;raw_input 是完整 prompt 口径,cached_input 是缓存命中部分。
    return {
        input: safeTokenInt(record.input),
        rawInput: safeTokenInt(record.raw_input),
        cachedInput: safeTokenInt(record.cached_input),
        output: safeTokenInt(record.output),
    }
}

export function hasAnyIo(payload: IoTokenPayload): boolean {
    return payload.input > 0 || payload.output > 0 || payload.rawInput > 0 || payload.cachedInput > 0
}

/**
 * 计算本轮实际传给模型的 input token(上下文窗口真实占用)。
 *
 * responses 续接类 provider(如 volcengine previous_response_id)的 usage 是增量口径,
 * 只包含新增消息部分;完整请求的 input 物理上不可能小于 system+tools 固定部分,
 * 检测到这种口径时补全固定部分,否则直接使用上报值(对齐原版 computeContextWindowUsedTokens)。
 */
export function computeContextWindowUsedTokens(options: {
    roundInput: number
    systemTokens: number
    toolTokens: number
}): number {
    const round = safeTokenInt(options.roundInput)
    const systemTokens = safeTokenInt(options.systemTokens)
    const toolTokens = safeTokenInt(options.toolTokens)
    const fixedTokens = systemTokens + toolTokens

    if (round > 0 && fixedTokens > 0 && round < fixedTokens) {
        return round + fixedTokens
    }

    return round
}

/**
 * 构建 Token 预算卡片数据模型(对齐原版 buildTokenBudgetTooltipModel)
 *
 * contextOn 表示是否传入历史上下文;estimated 表示本轮占用来自估算而非真实 usage。
 */
export function buildTokenBudgetTooltipModel(options: {
    limit: number
    used: number
    contextOn?: boolean
    totalInput: number
    rawInput: number
    cumulativeInput: number
    cachedInput: number
    systemTokens: number
    toolTokens: number
    estimated: boolean
}): TokenBudgetTooltipModel {
    const hasContextWindow = normalizeContextWindow(options.limit) > 0
    const contextOn = !!options.contextOn
    const totalInput = safeTokenInt(options.totalInput)
    const rawInput = Math.max(totalInput, safeTokenInt(options.rawInput), safeTokenInt(options.used))
    const cumulativeInput = safeTokenInt(options.cumulativeInput)
    const cachedInput = Math.max(0, safeTokenInt(options.cachedInput), Math.max(0, rawInput - totalInput))
    const systemTokens = safeTokenInt(options.systemTokens)
    const toolTokens = safeTokenInt(options.toolTokens)
    const contextTokens = contextOn ? Math.max(0, rawInput - systemTokens - toolTokens) : 0
    const reserveTokens = hasContextWindow ? Math.max(0, options.limit - options.used) : 0
    const pct = (n: number): string => {
        if (!hasContextWindow) {
            return '未配置'
        }

        const value = Math.max(0, Math.min(100, Math.round((Math.max(0, n) / Math.max(1, options.limit)) * 1000) / 10))

        return `${value.toFixed(1)}%`
    }

    return {
        limit: options.limit,
        hasContextWindow,
        used: options.used,
        remain: Math.max(0, options.limit - options.used),
        ratioRaw: hasContextWindow ? options.used / options.limit : 0,
        contextOn,
        rawInput,
        totalInput,
        cumulativeInput,
        cachedInput,
        systemTokens,
        toolTokens,
        contextTokens,
        reserveTokens,
        estimated: !!options.estimated,
        pct,
    }
}

/**
 * 生成 usage 悬浮提示文本(对齐原版 buildTokenBudgetHoverText:CTX 占用 / 原始输入 / 缓存 / 构成 / 计费 / 剩余)
 */
export function buildTokenBudgetHoverText(model: TokenBudgetTooltipModel): string {
    const hasContextWindow = model.hasContextWindow
    const used = model.used
    const limit = model.limit
    const ratioRaw = model.ratioRaw
    const rawInput = model.rawInput
    const cachedInput = model.cachedInput
    const systemTokens = model.systemTokens
    const toolTokens = model.toolTokens
    const contextForPrompt = model.contextTokens
    const exactBreakdown = !model.estimated
    const totalInput = model.totalInput
    const cumulativeInput = model.cumulativeInput
    const remain = model.remain
    const rows = [
        hasContextWindow
            ? `CTX 占用: ${used.toLocaleString()} / ${limit.toLocaleString()} (${Math.round(ratioRaw * 100)}%)`
            : `CTX 占用: ${used > 0 ? used.toLocaleString() : '--'} / 未配置`,
        `本轮原始输入: ${rawInput.toLocaleString()}`,
        `缓存命中: ${cachedInput.toLocaleString()}`,
        `系统/工具/上下文: ${systemTokens.toLocaleString()} / ${toolTokens.toLocaleString()} / ${contextForPrompt.toLocaleString()}${exactBreakdown ? '' : '（近似）'}`,
        `计费输入(本轮/累计): ${totalInput.toLocaleString()} / ${cumulativeInput.toLocaleString()}`,
        hasContextWindow
            ? `剩余窗口: ${remain.toLocaleString()}${model.estimated ? '（上限估算）' : ''}`
            : '剩余窗口: 未配置',
    ]

    return rows.join('\n')
}