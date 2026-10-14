/**
 * streamCaret.ts — 正文流式尾标(闪烁光标)的定位逻辑
 *
 * 背景:
 *   助手消息生成中时,正文末尾要显示一个闪烁方块表示「还在输出」。
 *   一条消息的分段序列常是「正文A → 工具 → 正文B → 工具 → …」,
 *   工具轮期间末尾是 function_call / function_result。
 *
 * 为什么不能要求「末段必须是正文」:
 *   工具调用后末段变成工具分段,尾标会立刻消失,直到模型重新吐正文才回来,
 *   用户看到的是「工具调用后输出提示小球不见了」。工具行有自己的执行中状态
 *   (节点脉冲 + 执行中徽标),但尾标仍需保持可见。
 *
 * 为什么尾标要挂在「最后一个分段」而不是「最后一个正文分段」:
 *   分段序列常是「正文A → 工具 → 正文B → 工具」,若固定挂在最后一个正文分段,
 *   尾标会停留在正文B 的尾部,而工具卡片渲染在它下方 —— 视觉上光标被工具卡片
 *   「甩在后面」,不再是内容末尾。用户期望光标始终跟随最下方输出。
 *   因此:末段是正文 → 挂在末段;末段是工具 → 仍挂在末段(工具卡片之后),
 *   保证尾标始终位于整条消息的最底部。
 *
 * 为什么不读消息级的 pending:
 *   云端 Remote 主区由会话级运行态驱动尾标(RemoteTaskPanel.isLiveAssistant),
 *   而消息的 pending 会被 queue_turn_end / done 帧的定稿置为 false —— 上一轮
 *   收尾时当前气泡的 pending 可能已经变 false,尾标便整轮不再出现。
 *   会话级 streaming 才是权威信号,消息级 pending 是冗余且会打架的判定。
 *
 * 抽成纯函数是为了可单测 —— 组件内的 computed 无法直接测试。
 */

/** 参与判定最小分段结构(与 MessageSegment 兼容) */
export interface CaretSegment {
    type: string
}

export interface CaretOptions {
    /** 是否正在流式生成(会话级权威信号) */
    isStreaming: boolean
    /** 正文是否已输出完毕(收到 done 帧后置真) */
    outputFinished: boolean
}

/**
 * 计算尾标应挂载的分段下标;返回 -1 表示不显示尾标。
 *
 * 挂载规则:
 *   - 末段是正文 → 挂在末段(正文尾部闪烁光标)
 *   - 末段是工具 → 仍挂在末段,使光标位于工具卡片之后、整条消息最底部,
 *     不会因工具调用而被"甩"在上一段正文尾部
 *
 * 不显示的情况:
 *   - 不在流式中 / 正文已输出完毕
 *   - 整条消息还没有任何分段(此时由 legacy pending ● 兜底)
 */
export function resolveStreamCaretIndex(
    segments: Array<CaretSegment>,
    options: CaretOptions
): number {
    if (!options.isStreaming || options.outputFinished) {
        return -1
    }

    if (!Array.isArray(segments) || segments.length === 0) {
        return -1
    }

    return segments.length - 1
}
