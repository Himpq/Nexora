/**
 * process-fold.test.mjs — 助手消息「过程区折叠」切分逻辑测试
 *
 * 严格对应四条规则:
 *   1. 必须存在正文分段,否则(纯工具轮/纯思考轮)不折叠
 *   2. 最后一个正文分段为错误不折叠
 *   3. 消息流式中不折叠
 *   4. 切分基准是最后一个正文分段,其后的工具/思考行留在过程区
 */

import assert from 'node:assert/strict'

import { buildProcessSectionSummary, resolveFinalContentIndex, resolveProcessItemIndexes } from '../src/stream/processFold.ts'

/** 构造渲染项:kind + sourceIndex,content 带 segment.text */
function item(kind, sourceIndex, text) {
    return text === undefined
        ? { kind, sourceIndex }
        : { kind, sourceIndex, segment: { text } }
}

const neverAnswered = () => false
const alwaysAnswered = () => true

const fold = (items, isStreaming = false) => resolveProcessItemIndexes(items, {
    isStreaming,
    isQuestionAnswered: neverAnswered,
})

// ---------- 规则 1:最后一条非正文不折叠 ----------

// 末尾工具行位于正文之后 → 它不属于「正文之前的过程」,不折叠
const endsWithTool = [
    item('reasoning', 0),
    item('content', 1, '我先看看。'),
    item('tool', 2),
]

assert.deepEqual([...fold(endsWithTool)].sort((a, b) => a - b), [0], '末尾工具行在正文之后,不进折叠区')

// 末尾思考行同理:正文之后的思考不折叠
const endsWithReasoning = [
    item('tool', 0),
    item('content', 1, '一段说明。'),
    item('reasoning', 2),
]

assert.deepEqual([...fold(endsWithReasoning)].sort((a, b) => a - b), [0], '末尾思考行在正文之后,不进折叠区')

// 末尾提问卡未作答 → 提问卡不折,正文之前的过程折叠
const endsWithQuestion = [
    item('tool', 0),
    item('content', 1, '需要授权。'),
    item('question', 2),
]

assert.deepEqual([...fold(endsWithQuestion)].sort((a, b) => a - b), [0], '未作答提问卡不折叠,正文之前的过程折叠')

// 工具行夹在正文中间(工具轮后续还有正文) → 工具行属于过程,应折叠
const toolBetweenContent = [
    item('content', 0, '我先看看文件结构。'),
    item('tool', 1),
    item('content', 2, '最终回复:已修复。'),
]

assert.deepEqual(
    [...fold(toolBetweenContent)].sort((a, b) => a - b),
    [0, 1],
    '正文之间的工具行属于过程,应折叠',
)

// 完全没有正文分段 → 没有可平铺的结论,不折叠
const toolOnly = [
    item('reasoning', 0),
    item('tool', 1),
]

assert.equal(fold(toolOnly).size, 0, '纯工具轮没有正文,不折叠')

// ---------- 规则 2:最后一条为错误不折叠 ----------

const endsWithError = [
    item('reasoning', 0),
    item('content', 1, '正在处理。'),
    { kind: 'content', sourceIndex: 2, segment: { text: '出错了', type: 'error' } },
]

assert.equal(fold(endsWithError).size, 0, '最后一项是错误分段时不折叠')

// ---------- 规则 3:消息流式中不折叠 ----------

const typical = [
    item('reasoning', 0),
    item('content', 1, '我先看看文件结构。'),
    item('tool', 2),
    item('content', 3, '发现一个问题。'),
    item('tool', 4),
    item('content', 5, '最终回复:已修复。'),
]

assert.equal(fold(typical, true).size, 0, '流式中不应折叠任何内容')

// ---------- 正常完成:最后一项是正文 → 折叠过程 ----------

const folded = fold(typical)

assert.deepEqual([...folded].sort((a, b) => a - b), [0, 1, 2, 3, 4], '过程项应折叠')
assert.equal(folded.has(5), false, '最终回复(最后一项正文)不能被折叠')

// ---------- 规则 4:中断场景 ----------

// 中断,最后一项是半截正文 → 可折叠
const abortedWithPartialContent = [
    item('reasoning', 0),
    item('tool', 1),
    item('content', 2, '正在输出一半的正文'),
]

const abortedFolded = fold(abortedWithPartialContent)

assert.equal(abortedFolded.has(2), false, '半截正文不能被折叠(它是最后一项)')
assert.equal(abortedFolded.has(0), true, '中断时半截正文之前的过程可折叠')
assert.equal(abortedFolded.has(1), true)

// 中断,最后一项是工具 → 正文之前的思考仍折叠,末尾工具行不进折叠区
const abortedWithTool = [
    item('reasoning', 0),
    item('content', 1, '正在输出一半的正文'),
    item('tool', 2),
]

assert.deepEqual([...fold(abortedWithTool)].sort((a, b) => a - b), [0], '中断时末尾工具行不进折叠区')

// ---------- 边界:正文就是第一项,无过程可折 ----------

assert.equal(fold([item('content', 0, '直接回复')]).size, 0, '正文是第一项时无过程可折')

// ---------- 边界:未作答的权限卡永不折叠 ----------

const withPendingQuestion = [
    item('tool', 0),
    item('question', 1),
    item('content', 2, '等待授权'),
]

const pendingFolded = fold(withPendingQuestion)

assert.equal(pendingFolded.has(1), false, '未作答的权限卡不能被折叠(否则看不到授权入口)')
assert.equal(pendingFolded.has(0), true, '同一条消息里的工具行仍应折叠')

// 已作答的权限卡可以折叠
const answeredFolded = resolveProcessItemIndexes(withPendingQuestion, {
    isStreaming: false,
    isQuestionAnswered: alwaysAnswered,
})

assert.equal(answeredFolded.has(1), true, '已作答的权限卡可以折叠')

// ---------- 边界:空输入 ----------

assert.equal(fold([]).size, 0)
assert.equal(resolveProcessItemIndexes(null, { isStreaming: false, isQuestionAnswered: neverAnswered }).size, 0)

// ---------- 摘要文案 ----------

assert.equal(buildProcessSectionSummary(typical, folded), '2 次工具调用 · 1 段思考 · 2 段过程输出')
assert.equal(buildProcessSectionSummary(typical, new Set()), '')

// ---------- 切分基准:最后一个正文分段 ----------

assert.equal(resolveFinalContentIndex(typical), 5, '取最后一个 content 项的下标')
assert.equal(resolveFinalContentIndex(endsWithTool), 1, '末尾工具行不改变正文基准')
assert.equal(resolveFinalContentIndex(endsWithReasoning), 1, '末尾思考行不改变正文基准')
assert.equal(resolveFinalContentIndex(toolOnly), -1, '没有正文分段时返回 -1')
assert.equal(resolveFinalContentIndex([]), -1)
assert.equal(resolveFinalContentIndex(null), -1)

console.log('Process fold tests passed')
