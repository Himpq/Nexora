/**
 * stream-caret.test.mjs — 正文流式尾标定位测试
 *
 * 覆盖两个已发布缺陷:
 *   1. 「工具调用后输出提示小球不见」:分段序列常是「正文A → 工具 → 正文B
 *      → 工具 → …」,工具轮期间末尾是 function_call / function_result。
 *      若要求末段必须是 content,尾标会在每次工具调用后消失。
 *   2. 「云端和本地都没有渐变动画小点」:尾标曾额外要求消息级 pending,
 *      而云端 Remote 主区的 pending 会被 queue_turn_end / done 帧的定稿
 *      置为 false,上一轮收尾时当前气泡的 pending 已变 false,尾标整轮不出现。
 *      会话级 streaming 才是权威信号。
 */

import assert from 'node:assert/strict'

import { resolveStreamCaretIndex } from '../src/stream/streamCaret.ts'

const streaming = { isStreaming: true, outputFinished: false }

// 末尾是工具分段:尾标必须仍挂在最后一个正文分段上
assert.equal(
    resolveStreamCaretIndex(
        [{ type: 'content' }, { type: 'function_call' }, { type: 'function_result' }],
        streaming,
    ),
    0,
    '工具轮末尾不得让尾标消失',
)

// 正文在工具之后:尾标挂最后一段正文
assert.equal(
    resolveStreamCaretIndex(
        [{ type: 'content' }, { type: 'function_result' }, { type: 'content' }],
        streaming,
    ),
    2,
)

// 思考分段不算正文
assert.equal(
    resolveStreamCaretIndex([{ type: 'reasoning' }, { type: 'content' }, { type: 'reasoning' }], streaming),
    1,
)

// 只有思考、还没吐正文:交给 legacy pending ● 兜底
assert.equal(resolveStreamCaretIndex([{ type: 'function_call' }], streaming), -1)
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
