/**
 * draftCall.ts — Workspace 草稿工具调用(workspace_draft_add)的流式渲染辅助
 *
 * 职责:
 *   - 识别草稿工具名(流式 delta 与完整调用事件统一判定)
 *   - 容错解析调用参数:流式期间参数 JSON 是逐步累积的截断文本,
 *     完整解析失败时按字段提取已流出的 title/content,让卡片随参数流式逐步呈现
 *   - 解析工具结果 JSON 为保存状态(已存入/失败),供卡片状态角标展示
 */

/** 草稿工具规范名(后端 server.py _workspace_draft_tool_definitions 注册) */
export const DRAFT_TOOL_NAME = 'workspace_draft_add'

/** 工具名归一化比较(去空白/下划线/连字符并小写,对齐 toolFlow.compactToolName) */
export function isDraftToolName(name: string): boolean {
    return String(name || '').trim().replace(/[\s_-]+/g, '').toLowerCase() === 'workspacedraftadd'
}

/** 草稿卡片状态:参数流式中 / 已存入 / 保存失败 / 结果不可解析 */
export type DraftCallState = 'streaming' | 'success' | 'failed' | 'unknown'

export interface DraftCallView {
    title: string
    content: string
    state: DraftCallState
    /** 失败时的错误信息(保存中/成功为空串) */
    message: string
}

/** 解析调用参数为卡片视图(流式截断 JSON 容错),初始状态为 streaming */
export function buildStreamingDraftCall(rawArgs: string): DraftCallView {
    const args = extractDraftArgs(rawArgs)

    return { ...args, state: 'streaming', message: '' }
}

/** 工具结果 JSON → 卡片终态(非 JSON/结构异常按 unknown,展示"已完成") */
export function resolveDraftCallResult(rawResult: string, view: DraftCallView): DraftCallView {
    try {
        const parsed = JSON.parse(String(rawResult || ''))

        if (parsed && typeof parsed === 'object') {
            if (parsed.success === true) {
                return { ...view, state: 'success', message: '' }
            }

            return { ...view, state: 'failed', message: String(parsed.message || parsed.error || '保存失败') }
        }
    } catch {
        // 结果非 JSON(异常路径文本):按 unknown 处理
    }

    return { ...view, state: 'unknown', message: '' }
}

/** 卡片状态角标文案 */
export function draftCallStateText(view: DraftCallView): string {
    if (view.state === 'streaming') {
        return '保存中'
    }

    if (view.state === 'success') {
        return '已存入草稿'
    }

    if (view.state === 'failed') {
        return '保存失败'
    }

    return '已完成'
}

/**
 * 容错解析参数 JSON:完整 JSON 直接解析;
 * 截断时逐字段提取已流出的字符串值(处理常见转义与未闭合引号)。
 */
function extractDraftArgs(raw: string): { title: string; content: string } {
    const text = String(raw || '').trim()

    if (!text) {
        return { title: '', content: '' }
    }

    try {
        const parsed = JSON.parse(text)

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return { title: String(parsed.title || ''), content: String(parsed.content || '') }
        }
    } catch {
        // 流式截断 JSON:落到字段级提取
    }

    return {
        title: extractJsonStringField(text, 'title'),
        content: extractJsonStringField(text, 'content'),
    }
}

/** 从截断 JSON 提取指定字符串字段的已流出部分(读到闭合引号或文本末尾为止) */
function extractJsonStringField(text: string, field: string): string {
    const match = text.match(new RegExp(`"${field}"\\s*:\\s*"`))

    if (!match || match.index === undefined) {
        return ''
    }

    let index = match.index + match[0].length
    let value = ''

    while (index < text.length) {
        const char = text[index]

        if (char === '"') {
            break
        }

        if (char === '\\' && index + 1 < text.length) {
            const next = text[index + 1]

            if (next === 'n' || next === '\n') {
                value += '\n'
                index += 2
                continue
            }

            if (next === 't') {
                value += '\t'
                index += 2
                continue
            }

            if (next === 'u' && index + 5 < text.length) {
                const code = Number.parseInt(text.slice(index + 2, index + 6), 16)

                if (Number.isFinite(code)) {
                    value += String.fromCharCode(code)
                    index += 6
                    continue
                }
            }

            value += next
            index += 2
            continue
        }

        value += char
        index += 1
    }

    return value
}
