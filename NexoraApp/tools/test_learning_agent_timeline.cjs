// Run the production Agent controller with a controlled clock, scroll surface and service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');

const emptyTarget = { lecture_id: '', lecture_title: '', book_id: '', book_title: '',
    chapter_index: -1, chapter_name: '', chapter_range: '' };
const target = { ...emptyTarget, lecture_id: 'course', book_id: 'book', chapter_index: 0 };
const entry = (id, ts, kind = 'agent_msg', extra = {}) => ({ id, ts, kind, text: id, ...extra });
const userMessages = (agent) => agent.timeline.filter((item) => item.kind === 'user_msg');
const turn = () => new Promise(setImmediate);
function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function holdRequest(f, mode = 'ask') {
    const pending = deferred();
    f.api[mode] = (text, context) => {
        f.requests.push(mode === 'plan' ? { mode, text } : { mode, text, context });
        return pending.promise;
    };
    return pending;
}

function fixture() {
    const source = fs.readFileSync(path.resolve(__dirname,
        '../entry/src/main/ets/components/agent/LearningAgent.ets'), 'utf8').split('\n    @Builder')[0] + '\n}';
    const plain = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '')
        .replace(/@(?:Component|ObjectLink|Prop|State|StorageProp|Watch|Link)(?:\([^)]*\))?\s*/g, '')
        .replace(/\bexport struct\b/g, 'class').replace(/^export\s/gm, '');
    const timers = [], scrolls = [], requests = [], owner = {};
    const now = Date.UTC(2026, 8, 27, 12, 0, 0, 123);
    const events = [entry('older', 10), entry('latest', 30)];
    const api = {
        async getToday() { return { status: 'resume', focus: target, today: {} }; },
        async getEvents() { return events.slice(); },
        async getContext() { return { lectures: [{ id: 'course', title: 'Course', books: [{ id: 'book', title: 'Book' }] }] }; },
        async ask(text, context) { requests.push({ mode: 'ask', text, context }); },
        async plan(text) { requests.push({ mode: 'plan', text }); },
    };
    const bindings = {
        NO_AGENT_TARGET: emptyTarget, NO_BOOK: {},
        ListScroller: class { scrollToIndex(...args) { scrolls.push(args); } },
        ScrollAlign: { START: 'start', CENTER: 'center', END: 'end' },
        LearningAgentApi: api,
        LearningHttp: { captureIdentity: () => owner, isCurrent: (candidate) => candidate === owner },
        LearningSystemEntry: { async updateToday() {} },
        LearningBridge: { latest: () => null },
        agentFailure: (error) => error.message,
        setTimeout: (callback) => { timers.push(callback); return timers.length; },
        Date: class extends Date {
            constructor(...args) { super(...(args.length > 0 ? args : [now])); }
            static now() { return now; }
        },
    };
    const { LearningAgent, AgentLevel } = new Function(...Object.keys(bindings),
        stripTypeScriptTypes(plain, { mode: 'transform' }) + '\nreturn { LearningAgent, AgentLevel };')(...Object.values(bindings));
    const agent = new LearningAgent();
    agent.alive = true;
    agent.navDepth = 0;
    agent.getUIContext = () => ({ getHostContext: () => undefined });
    const flush = async () => {
        await turn();
        let count = 0;
        while (timers.length > 0) {
            assert.ok(++count < 30, 'scroll scheduling must settle');
            timers.shift()();
            await turn();
        }
    };
    return { agent, api, events, scrolls, requests, flush, AgentLevel, now };
}

test('events stay chronological, including pending recommendations and equal-time request/reply pairs', () => {
    const { agent: a } = fixture();
    a.entries = [entry('pending', 40, 'agent_msg', { card: { type: 'proactive' }, status: 'pending' }),
        entry('question', 20, 'user_msg'), entry('answer', 20), entry('old', 10),
        entry('internal', 30, 'tool_step'), entry('hold', 35, 'agent_hold')];
    a.rebuildTimeline();
    assert.deepEqual(a.timeline.map((item) => item.id), ['old', 'question', 'answer', 'pending']);
    assert.equal(a.entries[0].id, 'pending', 'the API snapshot must not be mutated by sorting');
    a.launchDecision = 'internal';
    a.rebuildTimeline();
    assert.deepEqual(a.timeline.map((item) => item.id), ['old', 'question', 'answer', 'internal', 'pending']);
    a.showProcess = true;
    a.rebuildTimeline();
    assert.deepEqual(a.timeline.map((item) => item.id), ['old', 'question', 'answer', 'internal', 'hold', 'pending']);
});

test('first sync shows the latest message; scrolling history cancels queued following and refresh preserves it', async () => {
    const f = fixture(), a = f.agent;
    await a.refresh();
    await f.flush();
    assert.deepEqual(f.scrolls.at(-1), [2, false, 'end']);
    f.scrolls.length = 0;
    a.scrollToLatest();
    a.onTimelineScroll(-24);
    await f.flush();
    assert.deepEqual(f.scrolls, []);
    f.events.push(entry('new-reply', 50));
    await a.refresh();
    await f.flush();
    assert.deepEqual(f.scrolls, [], 'a new event must not pull the user out of older messages');
    a.scrollToLatest(true);
    await f.flush();
    assert.deepEqual(f.scrolls, [[3, false, 'end']]);
});

test('an overlay defers pending scroll until returning without losing the Agent draft', async () => {
    const f = fixture(), a = f.agent;
    a.timeline = f.events;
    a.draft = 'unfinished question';
    a.scrollToLatest(true);
    a.visible = false;
    a.onVisibleChanged();
    await f.flush();
    assert.deepEqual(f.scrolls, []);
    a.visible = true;
    a.onVisibleChanged();
    await f.flush();
    assert.deepEqual(f.scrolls, [[2, false, 'end']]);
    assert.equal(a.draft, 'unfinished question');
});

test('layout reaching the end cannot override a decision deep link, while scrolling there resumes following', async () => {
    const f = fixture(), a = f.agent;
    a.launchDecision = 'older';
    a.launchVersion = 1;
    const route = a.dispatchRoute(1);
    a.onTimelineEnd();
    await route;
    await a.refresh();
    await f.flush();
    assert.equal(a.followLatest, false);
    assert.deepEqual(f.scrolls, [[1, false, 'center']]);
    a.onTimelineScroll(16);
    a.onTimelineEnd();
    a.onTimelineScrollStop();
    assert.equal(a.followLatest, true);
    f.scrolls.length = 0;
    await a.refresh();
    await f.flush();
    assert.deepEqual(f.scrolls, [[2, false, 'end']]);
    a.onTimelineScroll(-16);
    a.onTimelineScrollStop();
    a.onTimelineEnd();
    assert.equal(a.followLatest, false, 'a later layout event is not part of the completed gesture');
});

test('the book action opens one Insights frame and back restores the timeline and unsent draft', async () => {
    const f = fixture(), a = f.agent, root = a.top();
    a.draft = 'unsent';
    a.onInsightsChanged();
    a.onInsightsChanged();
    await f.flush();
    assert.equal(a.frames.length, 2, 'repeated book taps must not stack duplicate Insights pages');
    assert.equal(a.top().level, f.AgentLevel.INSIGHTS);
    assert.equal(a.navDepth, 1);
    assert.equal(a.insightTarget.book_id, 'book');
    a.navDepth--;
    a.onNavDepthBack();
    await f.flush();
    assert.equal(a.top(), root);
    assert.equal(a.navDepth, 0);
    assert.equal(a.dayTab, 0);
    assert.equal(a.draft, 'unsent');
});

test('late Insights resolution cannot replace the page reached by back', async () => {
    const f = fixture(), a = f.agent, pending = deferred();
    f.api.getContext = () => pending.promise;
    a.onInsightsChanged();
    assert.equal(a.insightLoading, true);
    a.goBack();
    pending.resolve({ lectures: [{ id: 'old-course', books: [{ id: 'old-book' }] }] });
    await f.flush();
    assert.equal(a.top().level, f.AgentLevel.DAY);
    assert.equal(a.insightLoading, false);
    assert.equal(a.insightTarget.book_id, '');
});

test('question and plan drafts use their own operation and only the submitted draft is cleared', async () => {
    const f = fixture(), a = f.agent;
    a.focus = target;
    a.draft = '  explain this  ';
    a.planDraft = 'next chapter';
    const question = a.send();
    assert.equal(a.draft, '');
    assert.equal(a.planDraft, 'next chapter');
    assert.equal(userMessages(a)[0].text, 'explain this');
    await question;
    assert.deepEqual(f.requests[0], { mode: 'ask', text: 'explain this', context: target });
    a.draft = 'another unsent question';
    a.beginCompose();
    const plan = a.send('plan');
    assert.equal(a.planDraft, '');
    assert.equal(a.draft, 'another unsent question');
    assert.equal(userMessages(a).at(-1).text, 'next chapter');
    await plan;
    await f.flush();
    assert.equal(a.composerOpen, false);
    assert.equal(a.navDepth, 0);
    assert.deepEqual(f.requests[1], { mode: 'plan', text: 'next chapter' });
});

test('the question appears and the input clears before either the baseline or the answer arrives', async () => {
    const f = fixture(), a = f.agent, baseline = deferred(), answer = holdRequest(f);
    const snapshot = f.events.slice();
    let reads = 0;
    f.api.getEvents = () => ++reads === 1 ? baseline.promise : Promise.resolve(f.events.slice());
    a.draft = '  explain the next step\n  ';
    const sending = a.send();
    const message = userMessages(a)[0];
    assert.equal(a.draft, '', 'submission must clear the input synchronously');
    assert.equal(message.text, 'explain the next step');
    assert.equal(message.deliveryPending, true);
    assert.ok(message.id);
    assert.equal(a.entries.some((item) => item.id === message.id), false,
        'a local message must not be inserted into the service snapshot');
    await turn();
    assert.equal(f.requests.length, 0, 'the request waits for the baseline, while its message is already visible');
    baseline.resolve(snapshot);
    await turn();
    assert.equal(f.requests.length, 1);
    assert.equal(userMessages(a)[0].id, message.id);
    assert.equal(userMessages(a)[0].deliveryPending, true);
    f.events.push(entry('server-question', f.now - 123, 'user_msg', { text: message.text, channel: 'app' }));
    answer.resolve();
    await sending;
    assert.equal(userMessages(a).length, 1);
    assert.equal(userMessages(a)[0].id, message.id);
    assert.equal(Boolean(userMessages(a)[0].deliveryPending), false);
});

for (const mode of ['ask', 'plan']) {
    for (const outcome of ['success', 'failure']) {
        test(`${mode} preserves a second draft when the submitted request ends in ${outcome}`, async () => {
            const f = fixture(), a = f.agent, pending = holdRequest(f, mode);
            const field = mode === 'plan' ? 'planDraft' : 'draft';
            const otherField = mode === 'plan' ? 'draft' : 'planDraft';
            a.focus = target;
            a[field] = '  first request  ';
            a[otherField] = 'untouched other draft';
            if (mode === 'plan') { a.beginCompose(); }
            const sending = a.send(mode);
            assert.equal(a[field], '');
            const localId = userMessages(a)[0].id;
            a[field] = 'second draft typed while waiting';
            await turn();
            assert.equal(f.requests.length, 1);
            assert.equal(f.requests[0].text, 'first request');
            if (outcome === 'success') {
                f.events.push(entry('server-question', f.now - 123, 'user_msg', { text: 'first request', channel: 'app' }));
                pending.resolve();
            } else {
                pending.reject(new Error('request timed out'));
            }
            await sending;
            await f.flush();
            assert.equal(a[field], 'second draft typed while waiting');
            assert.equal(a[otherField], 'untouched other draft');
            assert.equal(a.sending, false);
            assert.equal(userMessages(a).length, 1);
            assert.equal(userMessages(a)[0].id, localId);
            assert.equal(Boolean(userMessages(a)[0].deliveryPending), false);
            if (outcome === 'failure') {
                assert.equal(userMessages(a)[0].deliveryError, 'request timed out');
                await a.refresh();
                await f.flush();
                assert.equal(userMessages(a)[0].deliveryError, 'request timed out');
            }
            assert.equal(f.requests.length, 1, 'neither failure nor refresh automatically resends the question');
        });
    }
}

test('refresh keeps an outgoing question, adopts its server record once, and leaves the server record unchanged', async () => {
    const f = fixture(), a = f.agent, pending = holdRequest(f);
    a.draft = 'keep this question visible';
    const sending = a.send();
    const localId = userMessages(a)[0].id;
    await turn();
    await a.refresh();
    assert.deepEqual(userMessages(a).map((item) => item.id), [localId]);
    const canonical = Object.freeze(entry('canonical-user', f.now - 123, 'user_msg', {
        text: 'keep this question visible', channel: 'app', unattended: false,
    }));
    const expected = { ...canonical };
    f.events.push(canonical);
    await a.refresh();
    await a.refresh();
    assert.deepEqual(userMessages(a).map((item) => item.id), [localId]);
    assert.equal(userMessages(a)[0].ts, canonical.ts);
    assert.deepEqual(a.entries.find((item) => item.id === canonical.id), expected);
    assert.deepEqual(canonical, expected);
    assert.equal(Object.hasOwn(canonical, 'deliveryPending'), false);
    assert.equal(Object.hasOwn(canonical, 'deliveryError'), false);
    f.events.push(entry('answer', canonical.ts));
    pending.resolve();
    await sending;
    await a.refresh();
    assert.deepEqual(userMessages(a).map((item) => item.id), [localId]);
    assert.equal(a.timeline.some((item) => item.id === 'answer'), true);
    assert.deepEqual(a.entries.find((item) => item.id === canonical.id), expected);
});

test('two identical questions in the same second remain two messages with separate server records', async () => {
    const f = fixture(), a = f.agent, text = 'please explain it again';
    const first = holdRequest(f);
    a.draft = text;
    const firstSend = a.send();
    const firstId = userMessages(a)[0].id;
    await turn();
    f.events.push(entry('server-first', f.now - 123, 'user_msg', { text, channel: 'app' }));
    first.resolve();
    await firstSend;
    const second = holdRequest(f);
    a.draft = text;
    const secondSend = a.send();
    const secondId = userMessages(a).find((item) => item.id !== firstId).id;
    assert.notEqual(firstId, secondId);
    await turn();
    await a.refresh();
    assert.deepEqual(userMessages(a).map((item) => item.id), [firstId, secondId],
        'the second question must not reuse the first question already present in its baseline');
    f.events.push(entry('server-second', f.now - 123, 'user_msg', { text, channel: 'app' }));
    await a.refresh();
    assert.deepEqual(userMessages(a).map((item) => item.id), [firstId, secondId]);
    assert.deepEqual(userMessages(a).map((item) => item.ts), [f.now - 123, f.now - 123]);
    second.resolve();
    await secondSend;
    await a.refresh();
    assert.deepEqual(userMessages(a).map((item) => item.id), [firstId, secondId]);
    assert.deepEqual(f.requests.map((request) => request.text), [text, text]);
    assert.deepEqual(a.entries.filter((item) => item.kind === 'user_msg').map((item) => item.id),
        ['server-first', 'server-second']);
});

test('a failed question cannot claim the canonical record of a later identical successful question', async () => {
    const f = fixture(), a = f.agent, text = 'please explain this chapter';
    const first = holdRequest(f);
    a.draft = text;
    const firstSend = a.send();
    const firstId = userMessages(a)[0].id;
    await turn();
    first.reject(new Error('chapter is invalid'));
    await firstSend;
    assert.equal(userMessages(a)[0].deliveryError, 'chapter is invalid');
    assert.equal(a.entries.some((item) => item.kind === 'user_msg'), false,
        'the rejected request did not produce a server record');

    const second = holdRequest(f);
    a.draft = text;
    const secondSend = a.send();
    const secondId = userMessages(a).find((item) => item.id !== firstId).id;
    await turn();
    assert.equal(f.requests.length, 2, 'the second request starts after a successful fresh baseline');
    f.events.push(entry('stored-second-question', f.now - 123, 'user_msg', { text, channel: 'app' }),
        entry('second-question-answer', f.now - 123));
    second.resolve();
    await secondSend;
    await a.refresh();
    await f.flush();

    const messages = userMessages(a);
    assert.equal(messages.length, 2, 'retain both attempts without duplicating the successful server record');
    const failed = messages.find((item) => item.id === firstId);
    const successful = messages.find((item) => item.id === secondId);
    assert.equal(failed.remoteId, '', 'an older failed send cannot claim a later send\'s record');
    assert.equal(failed.deliveryError, 'chapter is invalid');
    assert.equal(successful.remoteId, 'stored-second-question');
    assert.equal(successful.deliveryError, '');
    assert.equal(Boolean(successful.deliveryPending), false);
    assert.ok(a.timeline.findIndex((item) => item.id === secondId) <
        a.timeline.findIndex((item) => item.id === 'second-question-answer'),
        'the successful question must appear before its same-second server reply');
    assert.deepEqual(a.entries.filter((item) => item.kind === 'user_msg').map((item) => item.id),
        ['stored-second-question']);
});

test('a previously unseen identical question from the sending baseline is not mistaken for the new question', async () => {
    const f = fixture(), a = f.agent, pending = holdRequest(f), text = 'same wording';
    f.events.push(entry('historical-question', f.now - 123, 'user_msg', { text, channel: 'app' }));
    assert.equal(a.entries.length, 0, 'the displayed snapshot has not seen this historical question');
    a.draft = text;
    const sending = a.send();
    const localId = userMessages(a)[0].id;
    await turn();
    await a.refresh();
    assert.deepEqual(userMessages(a).map((item) => item.id), ['historical-question', localId]);
    f.events.push(entry('new-question', f.now - 123, 'user_msg', { text, channel: 'app' }));
    pending.resolve();
    await sending;
    assert.deepEqual(userMessages(a).map((item) => item.id), ['historical-question', localId]);
});

test('an identical question arriving from another channel cannot acknowledge an app question', async () => {
    const f = fixture(), a = f.agent, pending = holdRequest(f), text = 'shared wording';
    a.draft = text;
    const sending = a.send();
    const localId = userMessages(a)[0].id;
    await turn();
    f.events.push(entry('other-channel', f.now - 123, 'user_msg', { text, channel: 'xiaoyi' }));
    await a.refresh();
    assert.deepEqual(userMessages(a).map((item) => item.id), ['other-channel', localId]);
    f.events.push(entry('app-question', f.now - 123, 'user_msg', { text, channel: 'app' }));
    pending.resolve();
    await sending;
    assert.deepEqual(userMessages(a).map((item) => item.id), ['other-channel', localId]);
});

for (const stage of ['while waiting', 'after the reply']) {
    test(`an older refresh returning ${stage} cannot remove the submitted question or newer events`, async () => {
        const f = fixture(), a = f.agent, older = deferred(), pending = holdRequest(f);
        const oldSnapshot = f.events.slice();
        let oldReadStarted = false;
        f.api.getEvents = () => { oldReadStarted = true; return older.promise; };
        const oldRefresh = a.refresh();
        await turn();
        assert.equal(oldReadStarted, true);
        f.api.getEvents = async () => f.events.slice();
        a.draft = 'question after the old refresh';
        const sending = a.send();
        const localId = userMessages(a)[0].id;
        await turn();
        if (stage === 'while waiting') {
            older.resolve(oldSnapshot);
            await oldRefresh;
            assert.deepEqual(userMessages(a).map((item) => item.id), [localId]);
        }
        f.events.push(entry('new-user', f.now - 123, 'user_msg', { text: 'question after the old refresh', channel: 'app' }),
            entry('new-answer', f.now - 123));
        pending.resolve();
        await sending;
        if (stage === 'after the reply') {
            older.resolve(oldSnapshot);
            await oldRefresh;
        }
        assert.deepEqual(userMessages(a).map((item) => item.id), [localId]);
        assert.equal(a.timeline.some((item) => item.id === 'new-answer'), true);
        assert.equal(a.entries.some((item) => item.id === 'new-user'), true);
        assert.equal(a.entries.some((item) => item.id === 'new-answer'), true);
    });
}

test('a failed baseline lookup still sends once and refreshes after the request', async () => {
    const f = fixture(), a = f.agent, pending = holdRequest(f);
    let reads = 0;
    f.api.getEvents = async () => {
        if (++reads === 1) { throw new Error('baseline unavailable'); }
        return f.events.slice();
    };
    a.draft = 'send despite the baseline failure';
    const sending = a.send();
    const localId = userMessages(a)[0].id;
    await turn();
    assert.equal(f.requests.length, 1);
    assert.equal(a.draft, '');
    f.events.push(entry('stored-user', f.now - 123, 'user_msg', {
        text: 'send despite the baseline failure', channel: 'app',
    }));
    pending.resolve();
    await sending;
    assert.ok(reads >= 2, 'completion refreshes even when the baseline lookup failed');
    assert.deepEqual(userMessages(a).map((item) => item.id), [localId]);
    assert.equal(f.requests.length, 1);
});

test('a request failure after the user message was stored keeps one visible failed message without resending', async () => {
    const f = fixture(), a = f.agent, pending = holdRequest(f);
    a.draft = 'the server accepted this question';
    const sending = a.send();
    const localId = userMessages(a)[0].id;
    await turn();
    f.events.push(entry('stored-before-failure', f.now - 123, 'user_msg', {
        text: 'the server accepted this question', channel: 'app',
    }));
    pending.reject(new Error('model unavailable'));
    await sending;
    await a.refresh();
    await f.flush();
    assert.equal(a.draft, '');
    assert.deepEqual(userMessages(a).map((item) => item.id), [localId]);
    assert.equal(userMessages(a)[0].deliveryError, 'model unavailable');
    assert.equal(Boolean(userMessages(a)[0].deliveryPending), false);
    assert.equal(f.requests.length, 1);
});

test('scrolling while waiting prevents the reply from taking over history', async () => {
    const f = fixture(), a = f.agent, pending = holdRequest(f);
    a.draft = 'explain this while I read earlier messages';
    const sending = a.send();
    await turn();
    a.onTimelineScroll(-16);
    f.events.push(entry('stored-user', f.now - 123, 'user_msg', {
        text: 'explain this while I read earlier messages', channel: 'app',
    }), entry('reply', f.now - 123));
    pending.resolve();
    await sending;
    await f.flush();
    assert.equal(a.draft, '');
    assert.deepEqual(f.scrolls, [], 'manual navigation during generation takes precedence over reply following');
});

test('leaving Agent makes a late send result inert', async () => {
    const f = fixture(), a = f.agent, pending = holdRequest(f);
    a.draft = 'unfinished request';
    const sending = a.send();
    assert.equal(a.draft, '', 'the submitted draft was already moved to the timeline');
    assert.equal(userMessages(a)[0].text, 'unfinished request');
    a.draft = 'next unsent question';
    await turn();
    assert.equal(f.requests.length, 1);
    a.aboutToDisappear();
    pending.resolve();
    await sending;
    await f.flush();
    assert.equal(a.draft, 'next unsent question');
    assert.equal(a.actionNotice, '');
    assert.deepEqual(f.scrolls, []);
});

test('user messages cannot open evidence inspection, while Agent messages still can', () => {
    const f = fixture(), a = f.agent, root = a.top();
    a.openInspect(entry('my-question', f.now, 'user_msg', { reason: 'unexpected legacy metadata' }));
    assert.equal(a.top(), root);
    assert.equal(a.frames.length, 1);
    assert.equal(a.navDepth, 0);
    const response = entry('agent-answer', f.now, 'agent_msg', {
        reason: 'based on the selected chapter', evidence: [{ label: 'Chapter 1', source: 'textbook' }],
    });
    a.openInspect(response);
    assert.equal(a.top().level, f.AgentLevel.INSPECT);
    assert.equal(a.top().entry, response);
    assert.equal(a.navDepth, 1);
});
