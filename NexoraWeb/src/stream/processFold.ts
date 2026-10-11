/**
 * processFold.ts — 助手消息「过程区折叠」切分逻辑
 *
 * 背景:
 *   一条 assistant 消息常是「正文A → 工具 → 正文B → 工具 → 最终回复」。
 *   收尾后,最终回复之前的全部内容(思考/工具/过程正文)应收进外层折叠区,
 *   只留最终回复平铺,避免中间过程淹没结论。
 *
 * 切分基准是「最后一个正文分段」,而不是「渲染项数组的最后一项」:
 *   电脑端工具轮单独落盘、远端历史经 mergeToolOnlyAssistantRows 合并后,
 *   一条消息的末项常常是工具行(该轮以工具调用收尾),按末项判定会让整条
 *   消息永远折不上。工具行属于过程,不应阻断折叠。
 *
 * 折叠条件(全部满足才折叠):
 *   1. 存在正文(content)分段 —— 没有任何结论就没有可留的平铺内容
 *   2. 最后一个正文分段不是错误(error 分段)
 *   3. 消息不在流式中
 *   4. 最后一个正文分段之前必须还有其它渲染项
 *
 * 未作答的 question 卡片永不折叠:折进去用户看不到授权入口。
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

/** 最后一个正文渲染项在 items 中的下标;没有正文分段时返回 -1 */
export function resolveFinalContentIndex(items: Array<ProcessFoldItem>): number {
    if (!Array.isArray(items)) {
        return -1
    }

    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index].kind === 'content') {
            return index
        }
    }

    return -1
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

    // 规则 1:必须存在正文分段,否则(纯工具轮/纯思考轮)没有可平铺的结论
    const finalIndex = resolveFinalContentIndex(items)

    if (finalIndex < 0) {
        return indexes
    }

    // 规则 2:最后一个正文分段是错误分段时不折叠
    // (error 分段在 renderItems 里被归为 kind='tool',此处按分段类型再兜一层)
    if (items[finalIndex].segment?.type === 'error') {
        return indexes
    }

    // 规则 4:正文就是第一项时没有过程可折
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
