import assert from 'node:assert/strict'

import {
    beginRemoteQueuedTurn,
    createRemoteUserMessage,
    createStreamingAssistant,
    finalizeStreamingMessage,
} from '../src/stream/remoteSegments.ts'

const previous = createStreamingAssistant(1)
previous.segments = [{ type: 'content', text: 'first response' }]
finalizeStreamingMessage(previous)

assert.equal(previous.pending, false)
assert.equal(previous.outputFinished, true)

const messages = [createRemoteUserMessage(0, 'first prompt'), previous]
const next = beginRemoteQueuedTurn(messages, {
    _stream_seq: 3,
    type: 'queue_turn_start',
    message: 'second prompt',
    user_index: 2,
    assistant_index: 3,
}, 2)

assert.equal(previous.outputFinished, true, 'a finished queue turn must not keep the caret active')
assert.equal(next.outputFinished, false, 'the next queue turn must enable its caret')
assert.equal(next.pending, true)

const replayedAssistant = createStreamingAssistant(5)
replayedAssistant.outputFinished = true
replayedAssistant.status = 'completed'
const replayMessages = [createRemoteUserMessage(4, 'restored prompt'), replayedAssistant]
const replayed = beginRemoteQueuedTurn(replayMessages, {
    _stream_seq: 6,
    type: 'queue_turn_start',
    message: 'restored prompt',
    user_index: 4,
    assistant_index: 5,
}, 6)

assert.equal(replayed.outputFinished, false, 'replayed turns must clear the previous final marker')
assert.equal(replayed.status, 'streaming')

console.log('remote stream state tests passed')
