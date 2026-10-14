/**
 * stream-caret.test.mjs — 正文流式尾标定位测试
 *
 * 覆盖三个已发布缺陷:
 *   1. 「工具调用后输出提示小球不见」:分段序列常是「正文A → 工具 → 正文B
 *      → 工具 → …」,工具轮期间末尾是 function_call / function_result。
 *      若要求末段必须是 content,尾标会在每次工具调用后消失。
 *   2. 「云端和本地都没有渐变动画小点」:尾标曾额外要求消息级 pending,
 *      而云端 Remote 主区的 pending 会被 queue_turn_end / done 帧的定稿
 *      置为 false,上一轮收尾时当前气泡的 pending 已变 false,尾标整轮不出现。
 *      会话级 streaming 才是权威信号。
 *   3. 「工具调用后光标被甩在上一段正文尾部」:尾标曾固定挂最后一个正文分段,
 *      而工具卡片渲染在其下方,视觉上光标不再位于内容末尾。
 *      现在统一挂「最后一个分段」,保证尾标始终位于整条消息最底部。
 */

import assert from 'node:assert/strict'

import { resolveStreamCaretIndex } from '../src/stream/streamCaret.ts'

const streaming = { isStreaming: true, outputFinished: false }

// 末尾是工具分段:尾标挂到末段(工具卡片之后),不再回退到上一个正文分段
assert.equal(
    resolveStreamCaretIndex(
        [{ type: 'content' }, { type: 'function_call' }, { type: 'function_result' }],
        streaming,
    ),
    2,
    '工具轮末尾尾标必须跟随到最下方,不得停留在上一段正文尾部',
)

// 正文在工具之后:尾标挂最后一段正文
assert.equal(
    resolveStreamCaretIndex(
        [{ type: 'content' }, { type: 'function_result' }, { type: 'content' }],
        streaming,
    ),
    2,
)

// 思考分段不算正文,但作为末段时尾标仍需跟随到最下方
assert.equal(
    resolveStreamCaretIndex([{ type: 'reasoning' }, { type: 'content' }, { type: 'reasoning' }], streaming),
    2,
    '末段为思考时尾标跟随到末段,保持最下方',
)

// 只有工具、还没吐正文:尾标仍显示在工具之后(不再交给 legacy pending ● 兜底)
assert.equal(resolveStreamCaretIndex([{ type: 'function_call' }], streaming), 0)

// 完全没有任何分段:交给 legacy pending ● 兜底
assert.equal(resolveStreamCaretIndex([], streaming), -1)
assert.equal(resolveStreamCaretIndex(null, streaming), -1)

// 非流式 / 已输出完毕:一律不显示
assert.equal(resolveStreamCaretIndex([{ type: 'content' }], { ...streaming, isStreaming: false }), -1)
assert.equal(resolveStreamCaretIndex([{ type: 'content' }], { ...streaming, outputFinished: true }), -1)

// 消息级 pending 已不再是入参:即便消息被定稿过,只要会话仍在流式中就必须显示
assert.equal(
    resolveStreamCaretIndex([{ type: 'content' }], { isStreaming: true, outputFinished: false }),
    0,
    '尾标不得依赖消息级 pending',
)

console.log('stream caret tests passed')
