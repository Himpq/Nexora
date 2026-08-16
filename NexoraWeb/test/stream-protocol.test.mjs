/**
 * stream-protocol.test.mjs — StreamService SSE 协议解析测试
 *
 * 模拟 ChatDBServer /api/chat/stream 的真实输出序列,
 * 验证解析逻辑与后端协议一致(不依赖真实账号/后端):
 *   1. content / content_delta 正文增量
 *   2. reasoning_content / reasoning_delta 思考增量
 *   3. done 终帧携带完整内容
 *   4. stream_session 终帧 error 字段 → error 回调
 *   5. stream_session 终帧 cancel → aborted 回调
 *   6. [DONE] 正常结束
 *
 * 运行:node test/stream-protocol.test.mjs
 */

import assert from 'node:assert/strict'

import { StreamService } from '../src/stream/StreamService.ts'

/** 构造 SSE data 行 */
function sseLine(json) {
    return `data: ${JSON.stringify(json)}`
}

/** 运行一段 SSE 行序列,收集回调结果 */
async function runLines(lines) {
    const events = []
    const handlers = {
        onChunk(chunk) {
            events.push({ kind: 'chunk', chunk })
        },
        onEnd(reason, info) {
            events.push({ kind: 'end', reason, info })
        },
    }

    // 直接调用私有行解析(JS 运行时无真 private)
    for (const line of lines) {
        const ended = new StreamService()._handleLine(line, handlers)

        if (ended) {
            break
        }
    }

    return events
}

/** 场景 1:正常流(正文 + 思考 + done 终帧) */
async function testNormalStream() {
    const events = await runLines([
        sseLine({ type: 'stream_session', stream_id: 's1', conversation_id: 'c1', status: 'running' }),
        sseLine({ type: 'reasoning_content', content: '让我想想' }),
        sseLine({ type: 'reasoning_delta', delta: '继续' }),
        sseLine({ type: 'content', content: '你好' }),
        sseLine({ type: 'content_delta', delta: '，世界' }),
        sseLine({ type: 'content_delta', delta: '！' }),
        sseLine({ type: 'done', content: '你好，世界！' }),
        'data: [DONE]',
    ])

    const chunks = events.filter((e) => e.kind === 'chunk')
    const ends = events.filter((e) => e.kind === 'end')

    assert.equal(chunks.length, 7, '应收到 7 个数据块(含会话元信息)')
    assert.equal(ends.length, 1, '应恰好结束一次')
    assert.equal(ends[0].reason, 'done', '正常流应以 done 结束')
    assert.equal(ends[0].info.finalContent, '你好，世界！', 'done 终帧应携带完整内容')

    // 模拟增量拼接结果
    let text = ''
    for (const e of chunks) {
        const c = e.chunk

        if (c.type === 'content' || c.type === 'content_delta') {
            text += String(c.content || c.delta || '')
        }
    }

    assert.equal(text, '你好，世界！', '增量拼接应得到完整正文')

    console.log('✓ 场景1 正常流:正文增量/思考增量/done 终帧 均正确')
}

/** 场景 2:后端错误(stream_session 终帧 error 字段) */
async function testErrorFrame() {
    const events = await runLines([
        sseLine({ type: 'stream_session', stream_id: 's1', conversation_id: 'c1', status: 'running' }),
        sseLine({ type: 'content', content: '部分输出' }),
        sseLine({ type: 'stream_session', stream_id: 's1', conversation_id: 'c1', status: 'error', done: true, error: '模型配额不足' }),
    ])

    const ends = events.filter((e) => e.kind === 'end')

    assert.equal(ends.length, 1, '应恰好结束一次')
    assert.equal(ends[0].reason, 'error', '终帧 error 字段应触发 error 回调')
    assert.equal(ends[0].info.error, '模型配额不足', '应携带后端错误信息')

    console.log('✓ 场景2 后端错误:stream_session 终帧 error 正确上报')
}

/** 场景 3:用户取消(stream_session 终帧 cancel) */
async function testCancelFrame() {
    const events = await runLines([
        sseLine({ type: 'stream_session', stream_id: 's1', conversation_id: 'c1', status: 'running' }),
        sseLine({ type: 'stream_session', done: true, cancel_requested: true, cancel_reason: 'user_stop' }),
    ])

    const ends = events.filter((e) => e.kind === 'end')

    assert.equal(ends.length, 1, '应恰好结束一次')
    assert.equal(ends[0].reason, 'aborted', '取消终帧应触发 aborted 回调')

    console.log('✓ 场景3 用户取消:cancel 终帧正确上报')
}

/** 场景 4:仅 [DONE] 结束(无终帧) */
async function testDoneMarker() {
    const events = await runLines([
        sseLine({ type: 'stream_session', stream_id: 's1', conversation_id: 'c1', status: 'running' }),
        sseLine({ type: 'content', content: 'ok' }),
        'data: [DONE]',
    ])

    const ends = events.filter((e) => e.kind === 'end')

    assert.equal(ends.length, 1, '应恰好结束一次')
    assert.equal(ends[0].reason, 'done', '[DONE] 应以 done 结束')

    console.log('✓ 场景4 纯 [DONE] 结束:正常')
}

/** 场景 5:非 data 行(ping/注释)忽略 */
async function testIgnoreLines() {
    const events = await runLines([
        ': ping',
        'data: {"type":"stream_session","stream_id":"s1","conversation_id":"c1","status":"running"}',
        ': ping',
        'data: {"type":"content","content":"hi"}',
        'data: [DONE]',
    ])

    const chunks = events.filter((e) => e.kind === 'chunk')

    assert.equal(chunks.length, 2, 'ping 行应被忽略,只处理 data 行')

    console.log('✓ 场景5 非 data 行:ping/注释正确忽略')
}

await testNormalStream()
await testErrorFrame()
await testCancelFrame()
await testDoneMarker()
await testIgnoreLines()

console.log('\n全部协议测试通过 ✅')
