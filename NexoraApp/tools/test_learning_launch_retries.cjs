// Node >= 22.13; invoke the production MainChat launch methods with a controlled event loop and transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');
const source = fs.readFileSync(path.resolve(__dirname, '../entry/src/main/ets/pages/MainChat.ets'), 'utf8');
const turn = () => new Promise(setImmediate);
function deferred() {
    let resolve; const promise = new Promise((done) => { resolve = done; });
    return { resolve, promise };
}
function fixture() {
    const names = ['ensureLearningServices', 'loadLearningServices', 'onLaunchRequested', 'consumeLaunchRoute'];
    const methods = names.map((name) => {
        const found = source.match(new RegExp('^    private (?:async )?' + name + '\\([\\s\\S]*?^    }', 'm'));
        assert.ok(found, 'missing production method ' + name); return found[0];
    });
    const timers = [];
    const http = { configured: true };
    const bindings = {
        setTimeout: (callback) => { timers.push(callback); return timers.length; },
        LearningHttp: http, LearningSystemEntry: { prepare() {} },
        LearningReadingApi: { async flushReadingProgress() {} },
        hilog: { warn() {} }, DOMAIN: 0, TAG: '',
    };
    const MainChat = new Function(...Object.keys(bindings), stripTypeScriptTypes('class MainChat {\n' + methods.join('\n') + '\n}') +
        '\nreturn MainChat;')(...Object.values(bindings));
    const main = new MainChat();
    Object.assign(main, { attached: true, sessionReady: true, learningReady: null, launchConsuming: false,
        launchRequestVersion: 0, nxLaunchRoute: '', nxLaunchDecision: '', nxLaunchToken: 0,
        agentLaunchRoute: '', agentLaunchToken: 0, agentOpen: false, agentNavDepth: 0,
        getUIContext: () => ({ getHostContext: () => ({}) }), closeSidebar() {}, notify() {},
    });
    let calls = 0;
    let transport = async () => true;
    main.app = { username: 'user', loggedIn: true, learningEnabled: true,
        async refreshLearningRuntime() { calls++; http.configured = await transport(); this.learningEnabled = http.configured; } };
    const signal = (route, decision = '') => {
        main.nxLaunchDecision = decision; main.onLaunchRequested();
        main.nxLaunchRoute = route; main.onLaunchRequested();
        main.nxLaunchToken++; main.onLaunchRequested();
    };
    const flush = async () => {
        let count = 0;
        while (timers.length > 0) {
            assert.ok(++count < 20, 'a failed token must not cause an endless retry loop');
            timers.shift()(); await turn();
        }
        await turn();
    };
    return { main, signal, flush, calls: () => calls, transport: (value) => { transport = value; } };
}

test('pre-login routes stay pending and consume once after readiness', async () => {
    const f = fixture(); f.main.sessionReady = false;
    f.signal('reader', 'decision'); await f.flush();
    assert.equal(f.calls(), 0); assert.equal(f.main.nxLaunchRoute, 'reader');
    f.main.sessionReady = true; f.main.onLaunchRequested(); await f.flush();
    assert.equal(f.calls(), 1); assert.equal(f.main.agentLaunchToken, 1);
    assert.equal(f.main.agentLaunchDecision, 'decision'); assert.equal(f.main.nxLaunchRoute, '');
});

test('repeating the same route after it finishes causes one navigation per request', async () => {
    const f = fixture();
    f.signal('day'); await f.flush();
    f.signal('day'); await f.flush();
    assert.equal(f.calls(), 2); assert.equal(f.main.agentLaunchToken, 2);
});

test('a new launch received during a failed runtime request is retried after that request ends', async () => {
    const f = fixture(), gate = deferred(); let attempt = 0;
    f.transport(async () => ++attempt === 1 ? gate.promise : true);
    f.signal('day'); await f.flush();
    assert.equal(f.calls(), 1); assert.equal(f.main.launchConsuming, true);
    f.signal('review', 'new-decision'); await f.flush();
    gate.resolve(false); await turn(); await f.flush();
    assert.equal(f.calls(), 2, 'the second explicit request must not be lost behind the first failure');
    assert.equal(f.main.agentLaunchRoute, 'review');
    assert.equal(f.main.agentLaunchDecision, 'new-decision');
    assert.equal(f.main.nxLaunchRoute, '');
});

test('a failed request with no new launch does not retry indefinitely', async () => {
    const f = fixture(); f.transport(async () => false);
    f.signal('review'); await f.flush();
    assert.equal(f.calls(), 1); assert.equal(f.main.agentOpen, false);
    assert.equal(f.main.nxLaunchRoute, 'review');
});

test('a successful pending request consumes the latest target without duplicate navigation', async () => {
    const f = fixture(), gate = deferred(); f.transport(() => gate.promise);
    f.signal('day'); await f.flush();
    f.signal('review', 'latest'); await f.flush();
    gate.resolve(true); await turn(); await f.flush();
    assert.equal(f.calls(), 1); assert.equal(f.main.agentLaunchToken, 1);
    assert.equal(f.main.agentLaunchRoute, 'review'); assert.equal(f.main.agentLaunchDecision, 'latest');
});
