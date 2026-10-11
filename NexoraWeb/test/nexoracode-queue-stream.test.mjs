import assert from 'node:assert/strict'

import { ChatStreamClient } from '../src/network/chatStream.ts'

function sseLine(payload) {
    return `data: ${JSON.stringify(payload)}`
}

function createContext() {
    return {
        controller: new AbortController(),
        streamId: '',
        conversationId: 'conversation-queue',
        lastSeq: 0,
        reconnectAttempts: 0,
        endNotified: false,
    }
}

function runLines(lines) {
    const chunks = []
    const ends = []
    const client = new ChatStreamClient()
    const handlers = {
        onChunk(chunk) {
            chunks.push(chunk)
        },
        onEnd(reason, info) {
            ends.push({ reason, info })
        },
    }
    const context = createContext()
    const ended = []

    for (const line of lines) {
        ended.push(client.handleLine(line, handlers, context))
    }

    return { chunks, ends, ended, context }
}

function testQueuedTurnsEndOnlyAfterFinalSessionFrame() {
    const queueState = {
        type: 'queue_state',
        conversation_id: 'conversation-queue',
        items: [{ id: 'queued-2', message: 'Continue with the second task' }],
        paused: false,
        busy: true,
        active_item_id: 'queued-1',
        pending_guidance: 0,
        revision: 4,
    }
    const rollback = {
        type: 'queue_guide_rollback',
        conversation_id: 'conversation-queue',
        item_id: 'guide-3',
        message: 'Inspect the failing test first',
        reason: 'provider_error',
    }
    const finalMessage = {
        id: 12,
        role: 'assistant',
        content: 'The second queued task is complete.',
    }
    const result = runLines([
        sseLine({ type: 'stream_session', stream_id: 'stream-queue', conversation_id: 'conversation-queue', status: 'running' }),
        sseLine(queueState),
        sseLine(rollback),
        sseLine({ type: 'content', content: 'First response.' }),
        sseLine({ type: 'queue_turn_end', final_message: { id: 10, role: 'assistant', content: 'First response.' }, assistant_index: 10 }),
        sseLine({ type: 'queue_turn_start', conversation_id: 'conversation-queue', item_id: 'queued-2', message: 'Continue with the second task', user_index: 11, assistant_index: 12 }),
        sseLine({ type: 'content', content: 'The second queued task is complete.' }),
        sseLine({ type: 'done', content: 'The second queued task is complete.' }),
        sseLine({ type: 'stream_session', stream_id: 'stream-queue', conversation_id: 'conversation-queue', status: 'done', done: true, final_message: finalMessage, assistant_index: 12 }),
        'data: [DONE]',
    ])

    assert.equal(result.ends.length, 1, 'the whole queued run must produce one end callback')
    assert.equal(result.ends[0].reason, 'done')
    assert.deepEqual(result.ends[0].info.finalMessage, finalMessage)
    assert.equal(result.ends[0].info.assistantIndex, 12, 'the final assistant index must belong to the last turn')
    assert.equal(result.ended[3], false, 'content must not end the stream')
    assert.equal(result.ended[4], false, 'queue_turn_end must not end the stream')
    assert.equal(result.ended[5], false, 'queue_turn_start must not end the stream')
    assert.equal(result.ended[7], false, 'the model done frame must not end the stream')
    assert.equal(result.ended[8], true, 'the terminal stream_session frame ends the complete run')
    assert.deepEqual(result.chunks.find((chunk) => chunk.type === 'queue_state'), queueState)
    assert.deepEqual(result.chunks.find((chunk) => chunk.type === 'queue_guide_rollback'), rollback)
    assert.deepEqual(
        result.chunks.filter((chunk) => chunk.type === 'queue_turn_end' || chunk.type === 'queue_turn_start').map((chunk) => chunk.type),
        ['queue_turn_end', 'queue_turn_start'],
    )
}

function testErrorAndCancelNotifyEndOnce() {
    const cases = [
        {
            name: 'error',
            terminal: { type: 'stream_session', done: true, status: 'error', error: 'provider failed' },
            expectedReason: 'error',
        },
        {
            name: 'cancel',
            terminal: { type: 'stream_session', done: true, cancel_requested: true, cancel_reason: 'user_stop' },
            expectedReason: 'aborted',
        },
    ]

    for (const scenario of cases) {
        const result = runLines([
            sseLine({ type: 'stream_session', stream_id: `stream-${scenario.name}`, status: 'running' }),
            sseLine(scenario.terminal),
            'data: [DONE]',
            sseLine({ type: 'stream_session', done: true }),
        ])

        assert.equal(result.ends.length, 1, `${scenario.name} must produce one end callback`)
        assert.equal(result.ends[0].reason, scenario.expectedReason)
        assert.equal(result.ended[1], true)
        assert.equal(result.ended[2], true)
        assert.equal(result.ended[3], true)
    }
}

testQueuedTurnsEndOnlyAfterFinalSessionFrame()
testErrorAndCancelNotifyEndOnce()

console.log('NexoraCode queue stream protocol tests passed')
