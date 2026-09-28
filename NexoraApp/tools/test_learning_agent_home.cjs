// Node >= 22.13. Exercise production MainChat methods; only ArkUI and transport boundaries are mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../entry/src/main/ets/pages/MainChat.ets'), 'utf8');
const turn = () => new Promise(setImmediate);

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function fixture() {
    const names = ['toggleAgentMode', 'exitAgentMode', 'handleBackPress', 'openMail', 'closeMail',
        'openNotes', 'closeNotes', 'openLearning', 'ensureLearningServices', 'loadLearningServices',
        'onLaunchRequested', 'consumeLaunchRoute', 'openConversation', 'startNewRound'];
    const methods = names.map((name) => {
        const found = source.match(new RegExp('^    private (?:async )?' + name + '\\([\\s\\S]*?^    }', 'm'));
        assert.ok(found, 'missing production method ' + name);
        return found[0];
    });
    const timers = [];
    const effects = { runtime: 0, mailRefresh: 0, sidebarCloses: 0, notifications: [], cancelled: [],
        history: [], replacements: [], scrolls: [], prepared: 0 };
    const http = { configured: true };
    const bindings = {
        setTimeout: (callback) => { timers.push(callback); return timers.length; },
        LearningHttp: http,
        LearningSystemEntry: { prepare() { effects.prepared++; } },
        LearningReadingApi: { async flushReadingProgress() {} },
        chatStream: { cancel(key) { effects.cancelled.push(key); } },
        hilog: { warn() {} }, DOMAIN: 0, TAG: '',
    };
    const MainChat = new Function(...Object.keys(bindings), stripTypeScriptTypes(
        'class MainChat {\n' + methods.join('\n') + '\n}') + '\nreturn MainChat;')(...Object.values(bindings));
    const main = new MainChat();
    const background = { messages: [{ id: 'stream-reply', content: 'still generating' }],
        hasMore: true, oldestIndex: 12 };
    Object.assign(main, {
        attached: true, sessionReady: true, learningReady: null, launchConsuming: false,
        launchRequestVersion: 0, sidebarAgentLaunchToken: -1, nxLaunchRoute: '', nxLaunchDecision: '', nxLaunchToken: 0,
        agentOpen: false, agentNavDepth: 0, agentInsightsToken: 0,
        agentLaunchRoute: 'day', agentLaunchDecision: '', agentLaunchToken: 0,
        viewerUrl: '', showSheet: false, sidebarOpen: false,
        mailOpen: false, mailDetailOpen: false, notesOpen: false, noteEditorOpen: false,
        noteLaunchEditor: false, learningOpen: false, learningNavDepth: 0,
        conversationId: 'previous-chat', title: 'Previous conversation', draft: 'Unsent draft',
        messages: [{ id: 'previous-message', content: 'Ordinary chat history' }],
        streamingKeys: new Set(['streaming-chat']), buffers: new Map([['streaming-chat', background]]),
        getUIContext: () => ({ getHostContext: () => ({}) }),
        closeSidebar() { this.sidebarOpen = false; effects.sidebarCloses++; },
        returnToSettings() { return false; },
        closeSheet() { this.showSheet = false; },
        notify(message) { effects.notifications.push(message); },
        replaceMessages(messages) { this.messages = messages; effects.replacements.push(messages); },
        cancelJump() {}, stopBottomLoop() {}, syncStreamingState() {},
        loadHistory(id) { effects.history.push(id); },
        scrollToEnd(reason) { effects.scrolls.push(reason); },
        computeActiveTurnOfLastMessage() { return 3; },
    });
    let transport = async () => true;
    main.app = {
        username: 'user', loggedIn: true, learningEnabled: true,
        learningFrontendUrl: 'https://learning.example.test',
        async refreshLearningRuntime() {
            effects.runtime++;
            http.configured = await transport();
            this.learningEnabled = http.configured;
        },
        refreshMailList() { effects.mailRefresh++; },
    };
    // Mirror @StorageLink/@Watch notifications so toggle/cancel execute their own real launch flow.
    for (const key of ['nxLaunchRoute', 'nxLaunchDecision', 'nxLaunchToken']) {
        let value = main[key];
        Object.defineProperty(main, key, {
            get: () => value,
            set(next) {
                if (next === value) return;
                value = next;
                main.onLaunchRequested();
            },
        });
    }
    const flush = async () => {
        let count = 0;
        do {
            while (timers.length > 0) {
                assert.ok(++count < 30, 'launch cancellation must not produce an endless retry loop');
                timers.shift()();
                await turn();
            }
            await turn();
        } while (timers.length > 0);
    };
    return { main, effects, background, flush, transport: (next) => { transport = next; } };
}

function chatSnapshot(main) {
    return { conversationId: main.conversationId, title: main.title, draft: main.draft, messages: main.messages };
}

function assertChatRetained(main, before) {
    assert.equal(main.conversationId, before.conversationId);
    assert.equal(main.title, before.title);
    assert.equal(main.draft, before.draft);
    assert.equal(main.messages, before.messages, 'mode navigation must retain the ordinary message buffer');
}

function assertBackgroundRetained(f) {
    assert.equal(f.main.buffers.get('streaming-chat'), f.background);
    assert.equal(f.main.streamingKeys.has('streaming-chat'), true);
    assert.deepEqual(f.effects.cancelled, [], 'mode changes must not cancel background chat streams');
}

function assertAgentExited(main) {
    assert.equal(main.agentOpen, false);
    assert.equal(main.agentNavDepth, 0);
    assert.equal(main.agentInsightsToken, 0);
    assert.equal(main.agentLaunchDecision, '');
    assert.equal(main.nxLaunchRoute, '');
    assert.equal(main.nxLaunchDecision, '');
}

async function enterAgent(f) {
    f.main.sidebarOpen = true;
    f.main.toggleAgentMode();
    await f.flush();
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.agentLaunchRoute, 'day');
    assert.equal(f.main.sidebarOpen, false);
}

test('Agent sidebar toggle opens the home mode without replacing ordinary chat or cancelling its streams', async () => {
    const f = fixture(), before = chatSnapshot(f.main);
    await enterAgent(f);
    assert.equal(f.main.agentNavDepth, 0);
    assert.equal(f.main.agentLaunchToken, 1);
    assert.equal(f.effects.runtime, 1);
    assert.equal(f.effects.prepared, 1);
    assertChatRetained(f.main, before);
    assertBackgroundRetained(f);
    assert.deepEqual(f.effects.replacements, []);
});

test('clicking Agent again exits from an inner page and restores the same ordinary chat', async () => {
    const f = fixture(), before = chatSnapshot(f.main);
    await enterAgent(f);
    Object.assign(f.main, { agentNavDepth: 2, agentInsightsToken: 4,
        agentLaunchDecision: 'decision', agentLaunchRoute: 'review', sidebarOpen: true });
    const version = f.main.launchRequestVersion;
    f.main.toggleAgentMode();
    await f.flush();
    assertAgentExited(f.main);
    assert.equal(f.main.sidebarOpen, false);
    assert.ok(f.main.launchRequestVersion > version, 'exit invalidates queued launch callbacks');
    assertChatRetained(f.main, before);
    assertBackgroundRetained(f);
    assert.equal(f.effects.runtime, 1, 'exiting must not start another runtime request');
    f.main.toggleAgentMode();
    await f.flush();
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.agentLaunchRoute, 'day', 're-entry starts at the timeline instead of restoring the old review');
    assert.equal(f.main.agentNavDepth, 0);
    assertChatRetained(f.main, before);
});

test('new conversation exits Agent mode and keeps existing background streams alive', async () => {
    const f = fixture();
    await enterAgent(f);
    Object.assign(f.main, { agentNavDepth: 2, agentInsightsToken: 3 });
    f.main.startNewRound();
    await f.flush();
    assertAgentExited(f.main);
    assert.equal(f.main.conversationId, '');
    assert.equal(f.main.title, '新对话');
    assert.deepEqual(f.main.messages, []);
    assertBackgroundRetained(f);
});

test('opening a normal history conversation exits Agent and loads the selected history', async () => {
    const f = fixture();
    await enterAgent(f);
    f.main.agentNavDepth = 1;
    f.main.openConversation('another-chat', 'Another conversation');
    await f.flush();
    assertAgentExited(f.main);
    assert.equal(f.main.conversationId, 'another-chat');
    assert.equal(f.main.title, 'Another conversation');
    assert.deepEqual(f.effects.history, ['another-chat']);
    assertBackgroundRetained(f);
});

test('opening a cached streaming conversation exits Agent even on the buffer restore early return', async () => {
    const f = fixture();
    await enterAgent(f);
    Object.assign(f.main, { agentNavDepth: 2, agentInsightsToken: 3 });
    f.main.openConversation('streaming-chat', 'Streaming conversation');
    await f.flush();
    assertAgentExited(f.main);
    assert.equal(f.main.conversationId, 'streaming-chat');
    assert.equal(f.main.messages, f.background.messages);
    assert.equal(f.main.hasMoreMessages, true);
    assert.equal(f.main.oldestLoadedIndex, 12);
    assert.deepEqual(f.effects.history, []);
    assertBackgroundRetained(f);
});

const cancelActions = [
    ['click Agent again', (main) => main.toggleAgentMode(), 'previous-chat'],
    ['start a new conversation', (main) => main.startNewRound(), ''],
    ['select another conversation', (main) => main.openConversation('another-chat', 'Another conversation'), 'another-chat'],
];

for (const [label, cancel, expectedConversation] of cancelActions) {
    test('pending Agent launch cannot reopen after ' + label + ' and a late runtime success', async () => {
        const f = fixture(), gate = deferred();
        f.transport(() => gate.promise);
        f.main.toggleAgentMode();
        await f.flush();
        assert.equal(f.main.launchConsuming, true);
        assert.equal(f.main.nxLaunchRoute, 'day');
        assert.equal(f.main.agentOpen, false);
        cancel(f.main);
        await f.flush();
        assertAgentExited(f.main);
        gate.resolve(true);
        await f.flush();
        assertAgentExited(f.main);
        assert.equal(f.main.conversationId, expectedConversation);
        assert.equal(f.main.agentLaunchToken, 0, 'a cancelled request must never navigate');
        assert.equal(f.main.launchConsuming, false);
        assert.equal(f.effects.runtime, 1);
        assert.deepEqual(f.effects.notifications, []);
        assertBackgroundRetained(f);
    });
}

test('two Agent clicks in the same event turn cancel before runtime discovery starts', async () => {
    const f = fixture(), before = chatSnapshot(f.main);
    f.main.toggleAgentMode();
    f.main.toggleAgentMode();
    await f.flush();
    assertAgentExited(f.main);
    assert.equal(f.effects.runtime, 0);
    assertChatRetained(f.main, before);
});

test('a fresh Agent click after cancellation can reuse in-flight discovery without losing the new request', async () => {
    const f = fixture(), gate = deferred(), before = chatSnapshot(f.main);
    f.transport(() => gate.promise);
    f.main.toggleAgentMode();
    await f.flush();
    f.main.toggleAgentMode();
    assertAgentExited(f.main);
    f.main.toggleAgentMode();
    await f.flush();
    gate.resolve(true);
    await f.flush();
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.agentLaunchRoute, 'day');
    assert.equal(f.main.agentLaunchToken, 1);
    assert.equal(f.main.nxLaunchRoute, '');
    assert.equal(f.effects.runtime, 1);
    assertChatRetained(f.main, before);
});

test('cancelling a failed pending launch clears its target without retrying it', async () => {
    const f = fixture();
    f.transport(async () => false);
    f.main.toggleAgentMode();
    await f.flush();
    assert.equal(f.main.agentOpen, false);
    assert.equal(f.main.nxLaunchRoute, 'day');
    assert.equal(f.effects.notifications.length, 1);
    f.main.toggleAgentMode();
    await f.flush();
    assertAgentExited(f.main);
    assert.equal(f.effects.runtime, 1);
});

test('mail detail and list return to the same Agent mode and navigation depth', async () => {
    const f = fixture(), before = chatSnapshot(f.main);
    await enterAgent(f);
    f.main.agentNavDepth = 2;
    f.main.openMail();
    assert.equal(f.effects.mailRefresh, 1);
    assert.equal(f.main.mailOpen, true);
    assert.equal(f.main.agentOpen, true);
    f.main.mailDetailOpen = true;
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.mailDetailOpen, false);
    assert.equal(f.main.mailOpen, true);
    assert.equal(f.main.agentNavDepth, 2);
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.mailOpen, false);
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.agentNavDepth, 2);
    assertChatRetained(f.main, before);
});

test('notes editor and list return to the same Agent mode', async () => {
    const f = fixture(), before = chatSnapshot(f.main);
    await enterAgent(f);
    f.main.agentNavDepth = 1;
    f.main.openNotes(true);
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.noteEditorOpen, true);
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.noteEditorOpen, false);
    assert.equal(f.main.notesOpen, true);
    assert.equal(f.main.agentNavDepth, 1);
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.notesOpen, false);
    assert.equal(f.main.noteLaunchEditor, false);
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.agentNavDepth, 1);
    assertChatRetained(f.main, before);
});

test('learning navigation returns through its own pages before returning to Agent mode', async () => {
    const f = fixture(), before = chatSnapshot(f.main);
    await enterAgent(f);
    f.main.agentNavDepth = 2;
    await f.main.openLearning();
    assert.equal(f.main.learningOpen, true);
    assert.equal(f.main.agentOpen, true, 'opening Learning must retain Agent as the underlying mode');
    f.main.learningNavDepth = 2;
    for (const depth of [1, 0]) {
        assert.equal(f.main.handleBackPress(), true);
        assert.equal(f.main.learningNavDepth, depth);
        assert.equal(f.main.learningOpen, true);
        assert.equal(f.main.agentNavDepth, 2);
    }
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.learningOpen, false);
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.agentNavDepth, 2);
    assertChatRetained(f.main, before);
});

test('image, sheet and sidebar close before mail or Agent navigation handles Back', async () => {
    const f = fixture();
    await enterAgent(f);
    Object.assign(f.main, { agentNavDepth: 2, mailOpen: true, mailDetailOpen: true,
        sidebarOpen: true, showSheet: true, viewerUrl: 'file://preview.png' });
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.viewerUrl, '');
    assert.equal(f.main.showSheet, true);
    assert.equal(f.main.sidebarOpen, true);
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.showSheet, false);
    assert.equal(f.main.sidebarOpen, true);
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.sidebarOpen, false);
    assert.equal(f.main.mailDetailOpen, true);
    assert.equal(f.main.agentNavDepth, 2);
    assert.equal(f.main.agentOpen, true);
});

test('Agent Back pops inner pages but root Back retains Agent even with a previous ordinary conversation', async () => {
    const f = fixture(), before = chatSnapshot(f.main);
    await enterAgent(f);
    f.main.agentNavDepth = 2;
    for (const depth of [1, 0]) {
        assert.equal(f.main.handleBackPress(), true);
        assert.equal(f.main.agentNavDepth, depth);
        assert.equal(f.main.agentOpen, true);
    }
    assert.equal(f.main.handleBackPress(), false, 'Agent root Back delegates to the host instead of switching modes');
    assert.equal(f.main.agentOpen, true);
    assertChatRetained(f.main, before);
    assert.deepEqual(f.effects.replacements, []);
});

test('ordinary conversation Back still starts a new conversation when Agent mode is inactive', () => {
    const f = fixture();
    assert.equal(f.main.handleBackPress(), true);
    assert.equal(f.main.conversationId, '');
    assert.equal(f.main.agentOpen, false);
    assert.equal(f.main.handleBackPress(), false);
    assertBackgroundRetained(f);
});

for (const overlay of ['mail', 'notes']) {
    test('a delayed sidebar Agent launch preserves the ' + overlay + ' page opened while loading', async () => {
        const f = fixture(), pending = deferred();
        f.transport(() => pending.promise);
        f.main.toggleAgentMode();
        await f.flush();
        assert.equal(f.main.launchConsuming, true);
        if (overlay === 'mail') {
            f.main.openMail();
        } else {
            f.main.openNotes(true);
        }
        pending.resolve(true);
        await f.flush();
        assert.equal(f.main.agentOpen, true);
        assert.equal(f.main.nxLaunchRoute, '');
        if (overlay === 'mail') {
            assert.equal(f.main.mailOpen, true);
        } else {
            assert.equal(f.main.notesOpen, true);
            assert.equal(f.main.noteEditorOpen, true);
        }
    });
}

test('Learning and the Agent mode can finish shared initialization without dismissing each other', async () => {
    const f = fixture(), pending = deferred();
    f.transport(() => pending.promise);
    f.main.toggleAgentMode();
    await f.flush();
    const learning = f.main.openLearning();
    pending.resolve(true);
    await learning;
    await f.flush();
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.learningOpen, true);
    f.main.handleBackPress();
    assert.equal(f.main.learningOpen, false);
    assert.equal(f.main.agentOpen, true);
});

test('a newer system deep link still brings its target forward during sidebar initialization', async () => {
    const f = fixture(), pending = deferred();
    f.transport(() => pending.promise);
    f.main.toggleAgentMode();
    await f.flush();
    f.main.openNotes(true);
    f.main.nxLaunchDecision = 'review-decision';
    f.main.nxLaunchRoute = 'review';
    f.main.nxLaunchToken++;
    await f.flush();
    pending.resolve(true);
    await f.flush();
    assert.equal(f.main.agentLaunchRoute, 'review');
    assert.equal(f.main.agentLaunchDecision, 'review-decision');
    assert.equal(f.main.agentOpen, true);
    assert.equal(f.main.notesOpen, false);
    assert.equal(f.main.noteEditorOpen, false);
});
