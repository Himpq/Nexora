/**
 * processFold.ts — 助手消息「过程区折叠」切分逻辑
 *
 * 背景:
 *   一条 assistant 消息常是「正文A → 工具 → 正文B → 工具 → 最终回复」。
 *   收尾后,最终回复之前的全部内容(思考/工具/过程正文)应收进外层折叠区,
 *   只留最终回复平铺,避免中间过程淹没结论。
 *
 * 折叠条件(全部满足才折叠):
 *   1. 最后一项必须是正文(content)—— 最后一项是工具/思考/错误都不折叠
 *   2. 最后一项不能是错误(error 分段)
 *   3. 消息不在流式中
 *   4. 中断时:最后一项是正文(哪怕只输出一半)可折叠;是工具则不折叠
 *
 * 规则 1 已天然覆盖规则 4 的「工具不折叠」:中断后最后一项是工具 → 不折;
 * 中断后最后一项是半截正文 → 折(用户要求如此,半截正文仍算结论)。
 *
 * 抽成纯函数是为了可单测 —— 组件内的 computed 无法直接测试。
 */

/** 参与切分的最小渲染项结构(与 MessageItem 的 RenderItem 兼容) */
export interface ProcessFoldItem {
    kind: string
    sourceIndex: number
    segment?: { text?: string; type?: string }
}

export interface ProcessFoldOptions {
    /** 是否正在流式生成(流式中不折叠) */
    isStreaming: boolean
    /** 该 question 项是否已作答(未作答的永不折叠) */
    isQuestionAnswered: (item: ProcessFoldItem) => boolean
}

/**
 * 计算属于「过程区」的渲染项 sourceIndex 集合。
 *
 * 返回空集合表示无需折叠。
 */
export function resolveProcessItemIndexes(
    items: Array<ProcessFoldItem>,
    options: ProcessFoldOptions
): Set<number> {
    const indexes = new Set<number>()

    if (!Array.isArray(items) || items.length === 0) {
        return indexes
    }

    // 规则 3:流式中不折叠
    if (options.isStreaming) {
        return indexes
    }

    // 规则 1:最后一项必须是正文,否则(工具/思考/错误/提问)一律不折叠。
    // 这同时覆盖了规则 4 的「中断后最后一项是工具 → 不折叠」。
    const last = items[items.length - 1]

    if (last.kind !== 'content') {
        return indexes
    }

    // 规则 2:最后一项是错误分段时不折叠
    // (error 分段在 renderItems 里被归为 kind='tool',此处按分段类型再兜一层)
    if (last.segment?.type === 'error') {
        return indexes
    }

    const finalIndex = items.length - 1

    // 正文就是第一项时没有过程可折
    if (finalIndex <= 0) {
        return indexes
    }

    items.slice(0, finalIndex).forEach((item) => {
        // 未作答的 question 卡片不折叠:折进去用户看不到授权入口
        if (item.kind === 'question' && !options.isQuestionAnswered(item)) {
            return
        }

        indexes.add(item.sourceIndex)
    })

    return indexes
}

/** 过程区摘要文案:统计折叠了多少次工具调用 / 思考 / 过程输出 */
export function buildProcessSectionSummary(
    items: Array<ProcessFoldItem>,
    processIndexes: Set<number>
): string {
    let reasoning = 0
    let tools = 0
    let contents = 0

    items.forEach((item) => {
        if (!processIndexes.has(item.sourceIndex)) {
            return
        }

        if (item.kind === 'reasoning') {
            reasoning += 1
        } else if (item.kind === 'tool') {
            tools += 1
        } else if (item.kind === 'content') {
            contents += 1
        }
    })

    const parts: Array<string> = []

    if (tools > 0) {
        parts.push(`${tools} 次工具调用`)
    }

    if (reasoning > 0) {
        parts.push(`${reasoning} 段思考`)
    }

    if (contents > 0) {
        parts.push(`${contents} 段过程输出`)
    }

    return parts.join(' · ')
}
