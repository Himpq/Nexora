/**
 * token-budget.test.mjs — 上下文窗口(Token 预算)卡片纯逻辑测试
 *
 * 验证数据模型构建 / 占用计算 / io_tokens 读取 / 悬浮提示文案,
 * 数据形状对齐原版 chat.js buildTokenBudgetTooltipModel / computeContextWindowUsedTokens:
 *   1. normalizeContextWindow:非法/过小归零,超大收敛 4M
 *   2. io_tokens 读取:window 优先,cumulative 回退,最后一条助手消息
 *   3. computeContextWindowUsedTokens:增量口径补全固定部分
 *   4. tooltip model:占比/构成/缓存/计费/剩余 + pct 格式化
 *   5. hover text:CTX 占用 / 原始输入 / 缓存 / 构成 / 计费 / 剩余
 *
 * 运行:node test/token-budget.test.mjs
 */

import assert from 'node:assert/strict'

import {
    buildTokenBudgetHoverText,
    buildTokenBudgetTooltipModel,
    computeContextWindowUsedTokens,
    normalizeContextWindow,
    readLastAssistantIoTokens,
    readMessageIoTokens,
} from '../src/stream/tokenBudget.ts'

/** 场景 1:上下文窗口归一化 */
function testNormalizeContextWindow() {
    assert.equal(normalizeContextWindow(0), 0, '0 视为未配置')
    assert.equal(normalizeContextWindow(1023), 0, '小于 1024 视为未配置')
    assert.equal(normalizeContextWindow(1024), 1024, '达到 1024 生效')
    assert.equal(normalizeContextWindow(200000), 200000, '正常窗口原样保留')
    assert.equal(normalizeContextWindow(9000000), 4000000, '超大窗口收敛 4M')
    assert.equal(normalizeContextWindow(-5), 0, '负数归零')
    assert.equal(normalizeContextWindow(Number.NaN), 0, 'NaN 归零')
}

/** 场景 2:io_tokens metadata 读取(window 优先,cumulative 回退) */
function testReadMessageIoTokens() {
    const tokens = readMessageIoTokens({
        io_tokens_window: { input: 120, raw_input: 140, cached_input: 30, output: 60 },
        io_tokens_cumulative: { input: 999, output: 888 },
    })

    assert.equal(tokens.round.input, 120, 'round 取 io_tokens_window.input')
    assert.equal(tokens.round.rawInput, 140, 'round 按 snake_case 协议读取 raw_input')
    assert.equal(tokens.round.cachedInput, 30, 'round 按 snake_case 协议读取 cached_input')
    assert.equal(tokens.cumulative.input, 999, 'cumulative 取 io_tokens_cumulative.input')

    const fallback = readMessageIoTokens({ io_tokens: { input: 50, output: 20 } })

    assert.equal(fallback.round.input, 0, '无 window 口径 round 为空')
    assert.equal(fallback.cumulative.input, 50, '无 cumulative 时回退 io_tokens')

    const empty = readMessageIoTokens(null)

    assert.equal(empty.round.input, 0, '空 metadata 返回空 payload')
    assert.equal(empty.cumulative.output, 0, '空 metadata 返回空 payload')
}

/** 场景 3:读取最后一条带 io_tokens 的助手消息 */
function testReadLastAssistantIoTokens() {
    const messages = [
        { role: 'user', metadata: {} },
        { role: 'assistant', metadata: { io_tokens_window: { input: 10, output: 5 } } },
        { role: 'user', metadata: {} },
        { role: 'assistant', metadata: { io_tokens: { input: 20, output: 9 } } },
    ]

    const tokens = readLastAssistantIoTokens(messages)

    assert.equal(tokens.round.input, 0, '无 window 口径,round 为空')
    assert.equal(tokens.cumulative.input, 20, '取最后一条助手消息的 io_tokens')

    const none = readLastAssistantIoTokens([{ role: 'user', metadata: {} }])

    assert.equal(none.round.input, 0, '无助手消息返回空 payload')
    assert.equal(none.cumulative.input, 0, '无助手消息返回空 payload')
}

/** 场景 4:上下文占用计算(增量口径补全固定部分) */
function testComputeContextWindowUsedTokens() {
    const exact = computeContextWindowUsedTokens({ roundInput: 5000, systemTokens: 800, toolTokens: 200 })

    assert.equal(exact, 5000, '正常口径直接使用上报值')

    const incremental = computeContextWindowUsedTokens({ roundInput: 500, systemTokens: 800, toolTokens: 200 })

    assert.equal(incremental, 1500, '增量口径补全 system+tools 固定部分')

    const zero = computeContextWindowUsedTokens({ roundInput: 0, systemTokens: 0, toolTokens: 0 })

    assert.equal(zero, 0, '全零返回 0')

    const negative = computeContextWindowUsedTokens({ roundInput: -3, systemTokens: 10, toolTokens: 0 })

    assert.equal(negative, 0, '负数归零且不触发补全')
}

/** 场景 4.1:缓存计费口径下 CTX 占用取 raw_input(对齐 ChatInput.ctxUsed 口径) */
function testCachedUsageContextWindowOccupancy() {
    // 对齐 mujica/396 实测数据:input=35(缓存计费增量),raw_input=11427(完整 prompt)
    const messages = [
        { role: 'user', metadata: {} },
        {
            role: 'assistant',
            metadata: {
                io_tokens_window: { input: 35, output: 351, raw_input: 11427, cached_input: 11392 },
            },
        },
    ]
    const tokens = readLastAssistantIoTokens(messages)

    assert.equal(tokens.round.rawInput, 11427, 'snake_case raw_input 正确读取')
    assert.equal(tokens.round.input, 35, 'input 为缓存计费增量')

    // raw_input 存在时必须直接作为 CTX 占用,不得走"增量+固定部分"补全
    const used = tokens.round.rawInput > 0
        ? tokens.round.rawInput
        : computeContextWindowUsedTokens({ roundInput: tokens.round.input, systemTokens: 1448, toolTokens: 8720 })

    assert.equal(used, 11427, '缓存口径 CTX 占用 = raw_input,而非 input+固定部分')
}

/** 场景 5:tooltip 模型构建(占比/构成/缓存/计费/剩余 + pct) */
function testBuildTokenBudgetTooltipModel() {
    const model = buildTokenBudgetTooltipModel({
        limit: 200000,
        used: 50000,
        contextOn: true,
        totalInput: 48000,
        rawInput: 52000,
        cumulativeInput: 90000,
        cachedInput: 8000,
        systemTokens: 2000,
        toolTokens: 1000,
        estimated: false,
    })

    assert.equal(model.hasContextWindow, true, '已配置窗口')
    assert.equal(model.used, 50000, '占用')
    assert.equal(model.remain, 150000, '剩余')
    assert.ok(Math.abs(model.ratioRaw - 0.25) < 1e-9, '占比 25%')
    assert.equal(model.rawInput, 52000, '原始输入取 max(total, raw, used)')
    assert.equal(model.totalInput, 48000, '计费输入(本轮)')
    assert.equal(model.cumulativeInput, 90000, '计费输入(累计)')
    assert.equal(model.cachedInput, 8000, '缓存命中')
    assert.equal(model.contextTokens, 49000, '上下文 = rawInput - system - tool')
    assert.equal(model.reserveTokens, 150000, '保留 = limit - used')
    assert.equal(model.pct(model.systemTokens), '1.0%', '占比格式化 1 位小数')
    assert.equal(model.pct(50000), '25.0%', '占比格式化 25%')
}

/** 场景 6:未配置窗口时模型行为 */
function testBuildTokenBudgetTooltipModelNoWindow() {
    const model = buildTokenBudgetTooltipModel({
        limit: 0,
        used: 8000,
        contextOn: false,
        totalInput: 8000,
        rawInput: 8000,
        cumulativeInput: 8000,
        cachedInput: 0,
        systemTokens: 1000,
        toolTokens: 0,
        estimated: true,
    })

    assert.equal(model.hasContextWindow, false, '未配置窗口')
    assert.equal(model.ratioRaw, 0, '未配置窗口占比为 0')
    assert.equal(model.remain, 0, '未配置窗口剩余为 0')
    assert.equal(model.contextTokens, 0, '未传历史上下文上下文部分为 0')
    assert.equal(model.pct(1000), '未配置', '未配置窗口占比显示未配置')
}

/** 场景 7:悬浮提示文案 */
function testBuildTokenBudgetHoverText() {
    const model = buildTokenBudgetTooltipModel({
        limit: 200000,
        used: 50000,
        contextOn: true,
        totalInput: 48000,
        rawInput: 52000,
        cumulativeInput: 90000,
        cachedInput: 8000,
        systemTokens: 2000,
        toolTokens: 1000,
        estimated: false,
    })
    const text = buildTokenBudgetHoverText(model)

    assert.ok(text.includes('CTX 占用: 50,000 / 200,000 (25%)'), '包含 CTX 占用')
    assert.ok(text.includes('本轮原始输入: 52,000'), '包含原始输入')
    assert.ok(text.includes('缓存命中: 8,000'), '包含缓存命中')
    assert.ok(text.includes('系统/工具/上下文: 2,000 / 1,000 / 49,000'), '包含构成明细')
    assert.ok(text.includes('计费输入(本轮/累计): 48,000 / 90,000'), '包含计费输入')
    assert.ok(text.includes('剩余窗口: 150,000'), '包含剩余窗口')
    assert.ok(!text.includes('近似'), '精确口径不含近似标注')
}

/** 场景 8:估算口径标注 */
function testBuildTokenBudgetHoverTextEstimated() {
    const model = buildTokenBudgetTooltipModel({
        limit: 200000,
        used: 3000,
        contextOn: true,
        totalInput: 0,
        rawInput: 3000,
        cumulativeInput: 0,
        cachedInput: 0,
        systemTokens: 500,
        toolTokens: 0,
        estimated: true,
    })
    const text = buildTokenBudgetHoverText(model)

    assert.ok(text.includes('（近似）'), '估算口径构成明细带近似标注')
    assert.ok(text.includes('（上限估算）'), '估算口径剩余窗口带上限标注')
}

/** 场景 9:全部用例 */
function testAll() {
    testNormalizeContextWindow()
    testReadMessageIoTokens()
    testReadLastAssistantIoTokens()
    testComputeContextWindowUsedTokens()
    testCachedUsageContextWindowOccupancy()
    testBuildTokenBudgetTooltipModel()
    testBuildTokenBudgetTooltipModelNoWindow()
    testBuildTokenBudgetHoverText()
    testBuildTokenBudgetHoverTextEstimated()
}

testAll()

console.log('token-budget.test.mjs: 全部用例通过')