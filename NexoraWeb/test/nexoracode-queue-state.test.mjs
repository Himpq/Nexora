/**
 * nexoracode-queue-state.test.mjs — 队列状态共享与轮次切分测试
 *
 * 覆盖两个已发布缺陷:
 *   1. 队列状态按「设备 + 会话」全局共享 —— 同一会话被多个组件观察时,
 *      任一处删除/编辑后另一处必须立刻看到,不能各持一份副本。
 *   2. queue_turn_start 必须重建用户气泡与助手占位 —— 云端 Remote 主区
 *      没有本地 pendingStreams 缓冲,不处理就看不到队列消息。
 */

import assert from 'node:assert/strict'

import { applySharedQueueState, bumpSharedQueueRevision, readSharedQueueState, sharedQueueRevision } from '../src/stream/queueState.ts'
import { beginRemoteQueuedTurn, applyRemoteFinalMessage } from '../src/stream/remoteSegments.ts'

// ---------- 共享状态:写入必须推进响应式版本号 ----------

const revisionBefore = sharedQueueRevision().value

applySharedQueueState({
    conversation_id: 'conv_revision',
    device_id: 'device-r',
    items: [{ id: 'r1', message: '触发版本号' }],
    paused: false,
    busy: false,
    revision: 1,
})

assert.equal(
    sharedQueueRevision().value,
    revisionBefore + 1,
    '任何一次写入都必须推进响应式版本号,否则新增 key 不会触发观察方重算',
)

// 被 revision 守卫拒绝的旧状态不得推进版本号(避免无意义重算)
const revisionAfterAccept = sharedQueueRevision().value

applySharedQueueState({
    conversation_id: 'conv_revision',
    device_id: 'device-r',
    items: [],
    paused: false,
    busy: false,
    revision: 0,
})

assert.equal(sharedQueueRevision().value, revisionAfterAccept, '被守卫拒绝的写入不得推进版本号')

// 直接推进版本号也必须生效(观察方在 mutate 前后各推一次)
bumpSharedQueueRevision()

assert.equal(sharedQueueRevision().value, revisionAfterAccept + 1)

// ---------- 共享状态:revision 守卫 ----------

applySharedQueueState({
    conversation_id: 'conv_shared',
    device_id: 'device-a',
    items: [{ id: 'q1', message: '第一条' }],
    paused: false,
    busy: true,
    revision: 5,
})

const afterFirst = readSharedQueueState('device-a', 'conv_shared')

assert.equal(afterFirst.items.length, 1)
assert.equal(afterFirst.revision, 5)

// 旧版本号不得覆盖新版本号(接口响应与流事件可能乱序)
applySharedQueueState({
    conversation_id: 'conv_shared',
    device_id: 'device-a',
    items: [{ id: 'q1', message: '第一条' }, { id: 'q2', message: '第二条' }],
    paused: false,
    busy: true,
    revision: 4,
})

assert.equal(readSharedQueueState('device-a', 'conv_shared').items.length, 1, 'revision 更小的状态必须被忽略')

// 删除后的新版本号必须生效(这就是「删了不刷新」的修复点)
applySharedQueueState({
    conversation_id: 'conv_shared',
    device_id: 'device-a',
    items: [],
    paused: false,
    busy: false,
    revision: 6,
})

assert.equal(readSharedQueueState('device-a', 'conv_shared').items.length, 0, '删除后的空队列必须写入共享状态')

// 不同设备上的同名会话互不影响
applySharedQueueState({
    conversation_id: 'conv_shared',
    device_id: 'device-b',
    items: [{ id: 'other', message: '另一台电脑' }],
    paused: false,
    busy: false,
    revision: 1,
})

assert.equal(readSharedQueueState('device-a', 'conv_shared').items.length, 0)
assert.equal(readSharedQueueState('device-b', 'conv_shared').items.length, 1)

// ---------- 队列轮次切分 ----------

const messages = [
    { index: 0, role: 'user', content: '第一轮提问', status: 'completed' },
    { index: 1, role: 'assistant', content: '第一轮回复', status: 'streaming', pending: true, segments: [] },
]

const assistant = beginRemoteQueuedTurn(messages, {
    _stream_seq: 9,
    type: 'queue_turn_start',
    message: 'test for queue2',
    user_index: 2,
    assistant_index: 3,
}, 99)

assert.equal(messages.length, 4, '队列轮次必须补出用户气泡与助手占位')
assert.equal(messages[1].status, 'completed', '上一轮助手必须定稿')
assert.equal(messages[1].pending, false)
assert.equal(messages[2].role, 'user')
assert.equal(messages[2].content, 'test for queue2')
assert.equal(messages[2].index, 2, '用户气泡必须采用电脑端给的权威下标')
assert.equal(assistant.index, 3, '助手占位必须采用电脑端给的权威下标')
assert.equal(assistant.status, 'streaming')

// 电脑端未给下标时退化为本地自增,不产生 NaN
const fallbackMessages = [{ index: 0, role: 'user', content: '提问', status: 'completed' }]
const fallbackAssistant = beginRemoteQueuedTurn(fallbackMessages, {
    _stream_seq: 10,
    type: 'queue_turn_start',
    message: '引导消息',
}, 7)

assert.equal(fallbackMessages[1].index, 7)
assert.equal(fallbackAssistant.index, 8)

// ---------- 重放幂等:接管时从头重放不得把气泡翻倍 ----------

// restore() 会把游标归零、重放整条流。历史轮次的消息已由
// loadConversationHistory 落进 messages,再 push 一次就会出现双份气泡。
const replayMessages = [
    { index: 0, role: 'user', content: '第一轮提问', status: 'completed' },
    { index: 1, role: 'assistant', content: '第一轮回复', status: 'completed', pending: false },
    { index: 2, role: 'user', content: '第二轮提问', status: 'completed' },
    { index: 3, role: 'assistant', content: '', status: 'streaming', pending: true, segments: [] },
]

const replayTarget = beginRemoteQueuedTurn(replayMessages, {
    _stream_seq: 11,
    type: 'queue_turn_start',
    message: '第二轮提问',
    user_index: 2,
    assistant_index: 3,
}, 99)

assert.equal(replayMessages.length, 4, '重放已存在的轮次不得追加消息')
assert.equal(replayMessages.filter(m => m.role === 'user').length, 2, '用户气泡不得翻倍')
assert.equal(replayMessages.filter(m => m.role === 'assistant').length, 2, '助手气泡不得翻倍')
assert.equal(replayTarget, replayMessages[3], '必须复用已存在的那条助手消息')
assert.equal(replayTarget.status, 'streaming', '复用后必须重置为流式占位')
assert.equal(replayTarget.pending, true)

// 已定稿的历史轮次被重放时同样复用,不新增气泡
const replayFinal = beginRemoteQueuedTurn(replayMessages, {
    _stream_seq: 12,
    type: 'queue_turn_start',
    message: '第一轮提问',
    user_index: 0,
    assistant_index: 1,
}, 99)

assert.equal(replayMessages.length, 4, '重放历史轮次不得追加消息')
assert.equal(replayFinal, replayMessages[1], '必须复用历史里已定稿的那条助手消息')

// 空终帧不得把 null 目标写坏(轮次指针可能已置空)
applyRemoteFinalMessage(null, { role: 'assistant', content: '不该写入' })
applyRemoteFinalMessage(undefined, null)

// ---------- 轮次结束:用落盘消息定稿 ----------

const streaming = {
    index: 3,
    role: 'assistant',
    content: '流式累积的正文',
    status: 'streaming',
    pending: true,
    segments: [{ type: 'content', text: '流式累积的正文' }],
}

applyRemoteFinalMessage(streaming, {
    role: 'assistant',
    content: '电脑端落盘的正文',
    metadata: { process_steps: [{ type: 'content', content: '电脑端落盘的正文' }] },
})

assert.equal(streaming.content, '电脑端落盘的正文')
assert.equal(streaming.status, 'completed')
assert.equal(streaming.pending, false)
assert.deepEqual(streaming.segments, [{ type: 'content', text: '电脑端落盘的正文' }])

// 落盘消息正文为空时保留流式已累积的正文,避免气泡闪空
const keptContent = {
    index: 5,
    role: 'assistant',
    content: '已累积的正文',
    status: 'streaming',
    pending: true,
    segments: [{ type: 'content', text: '已累积的正文' }],
}

applyRemoteFinalMessage(keptContent, { role: 'assistant', content: '' })

assert.equal(keptContent.content, '已累积的正文', '空终帧不得清空已累积正文')
assert.equal(keptContent.status, 'completed')

console.log('NexoraCode queue state tests passed')
