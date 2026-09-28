// Exercise the production Agent navigation controller with controlled native reader resolution.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');

const target = (book = 'book') => ({ lecture_id: 'lecture', lecture_title: 'Course', book_id: book,
    book_title: 'Book', chapter_index: 0, chapter_name: 'Chapter', chapter_range: '' });
const emptyTarget = { ...target(''), lecture_id: '', lecture_title: '', book_title: '', chapter_name: '' };
const reader = () => ({ success: true, book: { id: 'book' }, chapters: [{ index: 0 }] });
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function loadController(filename, marker, names, bindings) {
    const source = fs.readFileSync(path.resolve(__dirname, '../entry/src/main/ets/components/agent', filename), 'utf8')
        .split(marker)[0] + '\n}';
    const plain = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '')
        .replace(/@(?:Component|ObjectLink|Prop|State|StorageProp|Watch|Link)(?:\([^)]*\))?\s*/g, '')
        .replace(/\bexport struct\b/g, 'class').replace(/^export\s/gm, '');
    return new Function(...Object.keys(bindings), stripTypeScriptTypes(plain, { mode: 'transform' }) +
        '\nreturn {' + names.join(',') + '};')(...Object.values(bindings));
}
function fixture() {
    const owner = {};
    const api = { getContext: async () => ({ lectures: [] }),
        getToday: async () => ({ status: 'resume', focus: target(), today: {} }), getEvents: async () => [] };
    const learning = { shared: { resolveReaderTarget: async () => reader() } };
    const { LearningAgent, AgentLevel } = loadController('LearningAgent.ets', '\n    @Builder',
        ['LearningAgent', 'AgentLevel'], { NO_AGENT_TARGET: emptyTarget, NO_BOOK: {},
            ListScroller: class { scrollToIndex() {} }, ScrollAlign: { START: 'start', CENTER: 'center', END: 'end' },
            LearningAgentApi: api, LearningApi: learning,
            LearningHttp: { captureIdentity: () => owner, isCurrent: (candidate) => candidate === owner },
            LearningSystemEntry: { updateToday: async () => {} }, agentFailure: (error) => error.message });
    const agent = new LearningAgent();
    agent.alive = true;
    agent.getUIContext = () => ({ getHostContext: () => undefined });
    return { agent, api, learning, AgentLevel };
}

test('reader failure stays on the report, survives refresh, and a single retry clears it', async () => {
    const f = fixture(), a = f.agent;
    await a.openReport(target());
    const report = a.top(), wait = deferred();
    let calls = 0;
    f.learning.shared.resolveReaderTarget = () => { calls++; return wait.promise; };
    a.errorText = 'existing timeline refresh failure';
    const pending = a.openReader(target());
    assert.equal(a.navigationOpening, true);
    assert.equal(a.navigationError, '');
    await a.openReader(target());
    assert.equal(calls, 1, 'repeated taps must not start another reader resolution');
    wait.resolve({ success: false, message: 'reader unavailable', book: null, chapters: [] });
    await pending;
    assert.equal(a.top(), report);
    assert.equal(a.navigationOpening, false);
    assert.match(a.navigationError, /reader unavailable/);
    assert.equal(a.errorText, 'existing timeline refresh failure');
    await a.refresh();
    assert.match(a.navigationError, /reader unavailable/, 'timeline refresh must not erase the navigation error');
    f.learning.shared.resolveReaderTarget = async () => reader();
    await a.openReader(target());
    assert.equal(a.top().level, f.AgentLevel.READER);
    assert.equal(a.navigationOpening, false);
    assert.equal(a.navigationError, '');
});

test('return cancels reader opening and a late failure cannot appear on the previous page', async () => {
    const f = fixture(), a = f.agent, wait = deferred();
    a.openReview(target());
    f.learning.shared.resolveReaderTarget = () => wait.promise;
    const pending = a.openReader(target());
    a.goBack();
    assert.equal(a.navigationOpening, false);
    assert.equal(a.navigationError, '');
    wait.resolve({ success: false, message: 'late failure', book: null, chapters: [] });
    await pending;
    assert.equal(a.top().level, f.AgentLevel.DAY);
    assert.equal(a.navigationError, '');
});

test('failed report target resolution remains visible on its originating page', async () => {
    const f = fixture(), a = f.agent, wait = deferred(), origin = a.top();
    await a.selectInsights();
    assert.equal(a.navigationError, '', 'Insights accepts an empty context before opening a concrete report');
    f.api.getContext = () => wait.promise;
    const pending = a.openReport(emptyTarget);
    assert.equal(a.navigationOpening, true);
    wait.resolve({ lectures: [] });
    await pending;
    assert.equal(a.top(), origin);
    assert.equal(a.navigationOpening, false);
    assert.match(a.navigationError, /可用教材/);
    await a.refresh();
    assert.match(a.navigationError, /可用教材/);
    await a.openReport(target());
    assert.equal(a.top().level, f.AgentLevel.REPORT);
    assert.equal(a.navigationError, '');
});

test('empty Insights contexts clear an old target without showing a navigation error', async () => {
    for (const context of [{ lectures: [] }, { lectures: [{ id: 'lecture', title: 'Course', books: [] }] }]) {
        const f = fixture(), a = f.agent, wait = deferred(), origin = a.top();
        a.focus = emptyTarget;
        a.insightTarget = target('previous-book');
        a.navigationError = 'previous navigation failure';
        f.api.getContext = () => wait.promise;
        const pending = a.selectInsights();
        assert.equal(a.dayTab, 1);
        assert.equal(a.insightLoading, true);
        assert.equal(a.navigationError, '');
        wait.resolve(context);
        await pending;
        assert.deepEqual(a.insightTarget, emptyTarget, 'a previous course must not remain in an empty Insights view');
        assert.equal(a.navigationError, '');
        assert.equal(a.insightLoading, false);
        assert.equal(a.top(), origin);
    }
});

test('a real Insights context failure remains visible instead of becoming a normal empty state', async () => {
    const f = fixture(), a = f.agent, origin = a.top();
    f.api.getContext = async () => { throw new Error('context request unavailable'); };
    await a.selectInsights();
    assert.equal(a.dayTab, 1);
    assert.equal(a.insightLoading, false);
    assert.match(a.navigationError, /context request unavailable/);
    assert.equal(a.top(), origin);
});

test('switching to the timeline cancels pending reader navigation', async () => {
    const f = fixture(), a = f.agent, wait = deferred();
    a.dayTab = 1;
    a.insightTarget = target();
    f.learning.shared.resolveReaderTarget = () => wait.promise;
    const pending = a.openReader(target());
    a.selectTimeline();
    assert.equal(a.navigationOpening, false);
    assert.equal(a.navigationError, '');
    wait.resolve(reader());
    await pending;
    assert.equal(a.frames.length, 1);
    assert.equal(a.dayTab, 0);
});

test('review ignores rereading while its existing navigation is opening', () => {
    const { LearningAgentReview } = loadController('LearningAgentReview.ets', '\n    build() {',
        ['LearningAgentReview'], { NO_AGENT_TARGET: emptyTarget });
    const review = new LearningAgentReview(), opened = [];
    review.selected = target();
    review.onRead = (source) => opened.push(source);
    review.navigationOpening = true;
    review.openReading();
    assert.equal(opened.length, 0);
    review.navigationOpening = false;
    review.openReading();
    assert.deepEqual(opened, [target()]);
});
