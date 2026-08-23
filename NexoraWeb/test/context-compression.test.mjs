/**
 * context-compression.test.mjs — 上下文压缩卡片纯逻辑测试
 *
 * 验证 context_compression_status 数据块的解析与文案格式化,
 * 数据形状对齐 ChatDBServer/api/App/Core/model.py 的真实输出:
 *   1. parse:start/done/skipped 合法块归一化,非法块返回 null
 *   2. resolve:流式本地 compressionStep 优先,历史回退 metadata.process_steps 最后一条
 *   3. trigger hint:force / overload(带窗口与阈值)/ 条件不满足 / 图片脱敏后缀
 *   4. output text:done 全量统计 + 摘要;start 等待文案;skipped 精简
 *
 * 运行:node test/context-compression.test.mjs
 */

import assert from 'node:assert/strict'

import {
    buildContextCompressionOutputText,
    buildContextCompressionTriggerHint,
    parseContextCompressionStep,
    resolveActiveContextCompressionStep,
} from '../src/stream/contextCompression.ts'

/** 场景 1:合法 start 块归一化 */
function testParseStartStep() {
    const step = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'start',
        content: '上下文压缩中（强制）',
        forced: true,
        trigger_mode: 'force',
        raw_input_tokens: 128000,
        context_window: 200000,
        compression_threshold: 180000,
        masked_image_data_urls: 2,
    })

    assert.ok(step, 'start 块应解析成功')
    assert.equal(step.status, 'start', 'status 应保留')
    assert.equal(step.trigger_mode, 'force', 'trigger_mode 应小写归一')
    assert.equal(step.raw_input_tokens, 128000, 'raw_input_tokens 应解析')
    assert.equal(step.masked_image_data_urls, 2, '脱敏图片数应解析')
}

/** 场景 2:非法块(类型不符 / 未知 status / 非对象)返回 null */
function testParseInvalidStep() {
    assert.equal(parseContextCompressionStep({ type: 'web_search', status: 'start' }), null, '非压缩类型应拒绝')
    assert.equal(parseContextCompressionStep({ type: 'context_compression_status', status: 'weird' }), null, '未知 status 应拒绝')
    assert.equal(parseContextCompressionStep(null), null, 'null 应拒绝')
    assert.equal(parseContextCompressionStep('text'), null, '非对象应拒绝')
}

/** 场景 3:数值容错(NaN/负数归零,索引可负) */
function testParseNumberTolerance() {
    const step = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'done',
        raw_input_tokens: -5,
        saved_tokens: Number.NaN,
        history_cut_index: 3,
    })

    assert.ok(step, '容错块应解析成功')
    assert.equal(step.raw_input_tokens, 0, '负数 token 归零')
    assert.equal(step.saved_tokens, 0, 'NaN token 归零')
    assert.equal(step.history_cut_index, 3, '截断索引保留整数')
}

/** 场景 4:resolve 优先级(本地压缩步骤 > 历史 process_steps 最后一条) */
function testResolvePriority() {
    const historyMessage = {
        metadata: {
            process_steps: [
                { type: 'context_compression_status', status: 'start', content: '上下文压缩中' },
                {
                    type: 'context_compression_status',
                    status: 'done',
                    content: '上下文压缩完成',
                    saved_tokens: 50000,
                    saved_ratio: 0.4,
                },
            ],
        },
    }

    const fromHistory = resolveActiveContextCompressionStep(historyMessage)

    assert.ok(fromHistory, '历史回放应解析出压缩步骤')
    assert.equal(fromHistory.status, 'done', '应取 process_steps 最后一条(done)')
    assert.equal(fromHistory.saved_tokens, 50000, 'done 统计应透传')

    const liveMessage = {
        compressionStep: { type: 'context_compression_status', status: 'start', content: '上下文压缩中（强制）' },
        metadata: historyMessage.metadata,
    }

    const fromLive = resolveActiveContextCompressionStep(liveMessage)

    assert.ok(fromLive, '流式本地步骤应解析成功')
    assert.equal(fromLive.status, 'start', '流式进行中应以本地为准')
    assert.equal(fromLive.content, '上下文压缩中（强制）', '本地 content 应保留')

    assert.equal(resolveActiveContextCompressionStep({}), null, '无任何数据时返回 null')
}

/** 场景 5:触发原因提示(force / overload / skipped / 图片脱敏) */
function testTriggerHint() {
    const force = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'start',
        trigger_mode: 'force',
        masked_image_data_urls: 3,
    })

    assert.ok(force, 'force 块应解析成功')
    assert.equal(
        buildContextCompressionTriggerHint(force),
        '触发原因：强制触发 · 图片脱敏 3 张',
        'force 应拼接脱敏后缀'
    )

    const overload = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'start',
        trigger_mode: 'overload',
        raw_input_tokens: 150000,
        context_window: 200000,
        compression_threshold: 180000,
    })

    assert.ok(overload, 'overload 块应解析成功')
    assert.equal(
        buildContextCompressionTriggerHint(overload),
        '触发原因：上下文过载（150,000 / 200,000），阈值 180,000',
        'overload 应带原始输入/窗口/阈值'
    )

    const overloadNoWindow = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'start',
        trigger_mode: 'overload',
    })

    assert.ok(overloadNoWindow, '无窗口 overload 块应解析成功')
    assert.equal(
        buildContextCompressionTriggerHint(overloadNoWindow),
        '触发原因：上下文过载',
        '缺少窗口时应降级为纯文案'
    )

    const skipped = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'skipped',
        content: '上下文压缩跳过（当前模型未配置上下文窗口）',
    })

    assert.ok(skipped, 'skipped 块应解析成功')
    assert.equal(buildContextCompressionTriggerHint(skipped), '触发原因：条件不满足', 'skipped 应提示条件不满足')
}

/** 场景 6:展开正文(done 全量统计 + 摘要 / start 等待 / skipped 精简) */
function testOutputText() {
    const done = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'done',
        trigger_mode: 'overload',
        raw_input_tokens: 150000,
        context_window: 200000,
        compression_threshold: 180000,
        post_raw_input_tokens: 90000,
        saved_tokens: 60000,
        saved_ratio: 0.4,
        history_cut_index: 7,
        summary_chars: 320,
        summary_text: '用户正在开发 NexoraWeb 前端迁移,重点关注 GDDP 组件集成。',
    })

    assert.ok(done, 'done 块应解析成功')
    const doneText = buildContextCompressionOutputText(done)

    assert.ok(doneText.includes('压缩前输入: 150,000 tokens'), '应含压缩前输入')
    assert.ok(doneText.includes('上下文窗口: 200,000'), '应含上下文窗口')
    assert.ok(doneText.includes('触发阈值: 180,000'), '应含触发阈值')
    assert.ok(doneText.includes('压缩后输入: 90,000 tokens'), '应含压缩后输入')
    assert.ok(doneText.includes('节省: 60,000 tokens (40%)'), '应含节省统计')
    assert.ok(doneText.includes('历史截断索引: 7'), '应含截断索引')
    assert.ok(doneText.includes('摘要长度: 320 字符'), '应含摘要长度')
    assert.ok(doneText.includes('压缩摘要:'), '应含摘要标题')
    assert.ok(doneText.includes('GDDP 组件集成'), '应含摘要正文')

    const start = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'start',
        content: '上下文压缩中',
    })

    assert.ok(start, 'start 块应解析成功')
    const startText = buildContextCompressionOutputText(start)

    assert.ok(startText.includes('压缩任务已开始，等待模型生成摘要...'), 'start 应提示等待摘要')

    const skipped = parseContextCompressionStep({
        type: 'context_compression_status',
        status: 'skipped',
    })

    assert.ok(skipped, 'skipped 块应解析成功')
    const skippedText = buildContextCompressionOutputText(skipped)

    assert.equal(skippedText, '触发原因：条件不满足', 'skipped 正文应仅含触发原因')
}

/** 汇总运行 */
function main() {
    const cases = [
        ['parse:start 块归一化', testParseStartStep],
        ['parse:非法块拒绝', testParseInvalidStep],
        ['parse:数值容错', testParseNumberTolerance],
        ['resolve:优先级与历史回放', testResolvePriority],
        ['hint:触发原因文案', testTriggerHint],
        ['output:展开正文', testOutputText],
    ]

    for (const [name, run] of cases) {
        run()
        console.log(`ok - ${name}`)
    }

    console.log(`\n${cases.length} 组用例全部通过`)
}

main()