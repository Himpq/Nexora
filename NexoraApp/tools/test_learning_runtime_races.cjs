// Node >= 22.13; exercises the real AppState and LearningHttp classes with controlled HTTP completion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');
const common = path.resolve(__dirname, '../entry/src/main/ets/common');

function load(name, names, bindings) {
    const source = fs.readFileSync(path.join(common, name + '.ets'), 'utf8')
        .replace(/^import\s[\s\S]*?;\r?\n/gm, '').replace(/^@Observed\r?\n/gm, '').replace(/^export\s/gm, '');
    return new Function(...Object.keys(bindings), stripTypeScriptTypes(source) + '\nreturn { ' + names.join(',') + ' };')(
        ...Object.values(bindings));
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function setup() {
    const storage = new Map([['nxSessionReady', true]]);
    const AppStorage = { get: (key) => storage.get(key), setOrCreate: (key, value) => storage.set(key, value) };
    const pending = [];
    let logoutWait = Promise.resolve();
    let backend = 'https://chat-a.example';
    let cookie = 'session=a';
    const HttpUtil = {
        getBackendUrl: () => backend, setBackendUrl: (value) => { backend = value; },
        getSessionCookie: () => cookie, setSessionCookie: (value) => { cookie = value; },
        hasSession: () => cookie.length > 0,
        async logout() { await logoutWait; cookie = ''; },
    };
    const hilog = { info() {}, warn() {}, error() {} };
    const { LearningHttp } = load('LearningHttp', ['LearningHttp'], { HttpUtil, AppStorage, hilog });
    const LearningApi = { shared: { configure: (username, url = '') => LearningHttp.configure(username, url) } };
    const ApiService = {
        fetchLearningRuntime() { const result = deferred(); pending.push(result); return result.promise; },
    };
    const { AppState } = load('AppState', ['AppState'], {
        AppStorage, HttpUtil, ApiService, LearningApi, LearningHttp, hilog,
        DEFAULT_BACKEND_URL: backend,
    });
    const app = new AppState();
    app.username = 'user-a'; app.backendUrl = backend; app.loggedIn = true;
    LearningHttp.configure(app.username, 'https://learn-a.example');
    function setSession(username, backendUrl) {
        app.username = username; app.backendUrl = backendUrl; app.loggedIn = true;
        HttpUtil.setBackendUrl(backendUrl); HttpUtil.setSessionCookie('session=' + username);
        storage.set('nxSessionReady', true);
    }
    return { app, LearningHttp, HttpUtil, pending, setSession,
        waitLogout: (promise) => { logoutWait = promise; } };
}

const runtime = (frontendUrl) => ({ success: true, message: '', enabled: true, frontendUrl });

test('logout invalidates Learning identity before the logout HTTP request completes', async () => {
    const { app, LearningHttp, waitLogout } = setup();
    const gate = deferred(); waitLogout(gate.promise);
    const logout = app.signOut();
    const beforeHttpReturns = LearningHttp.captureIdentity();
    gate.resolve(); await logout;
    assert.equal(beforeHttpReturns, null);
});

test('a delayed runtime response cannot re-enable a logged-out username', async () => {
    const { app, LearningHttp, pending } = setup();
    const old = app.refreshLearningRuntime();
    await app.signOut();
    pending[0].resolve(runtime('https://stale-learning.example'));
    await old;
    assert.equal(LearningHttp.captureIdentity(), null);
    assert.equal(app.learningEnabled, false);
    assert.equal(app.learningFrontendUrl, '');
});

test('an old account response cannot bind the new username to the old learning service', async () => {
    const { app, LearningHttp, pending, setSession } = setup();
    const old = app.refreshLearningRuntime();
    await app.signOut();
    setSession('user-b', 'https://chat-b.example');
    const latest = app.refreshLearningRuntime();
    pending[1].resolve(runtime('https://learn-b.example'));
    await latest;
    pending[0].resolve(runtime('https://learn-a.example'));
    await old;
    assert.equal(LearningHttp.captureIdentity().username, 'user-b');
    assert.equal(LearningHttp.captureIdentity().serviceBase, 'https://learn-b.example');
    assert.equal(app.learningFrontendUrl, 'https://learn-b.example');
});

test('the newest runtime refresh wins even within the same authenticated session', async () => {
    const { app, LearningHttp, pending } = setup();
    const old = app.refreshLearningRuntime();
    const latest = app.refreshLearningRuntime();
    pending[1].resolve(runtime('https://new-learning.example'));
    await latest;
    pending[0].resolve(runtime('https://old-learning.example'));
    await old;
    assert.equal(LearningHttp.captureIdentity().serviceBase, 'https://new-learning.example');
});

test('changing the chat backend invalidates its pending Learning configuration', async () => {
    const { app, LearningHttp, pending } = setup();
    const old = app.refreshLearningRuntime();
    await app.updateBackendUrl('https://chat-b.example');
    pending[0].resolve(runtime('https://learn-a.example'));
    await old;
    assert.equal(LearningHttp.captureIdentity(), null);
});

test('an unauthenticated runtime refresh makes no configuration request', async () => {
    const { app, LearningHttp, pending } = setup();
    await app.signOut();
    const refresh = app.refreshLearningRuntime();
    // Keep this test bounded against a regression that accidentally starts an unauthenticated request.
    if (pending.length > 0) pending[0].resolve(runtime('https://unexpected.example'));
    await refresh;
    assert.equal(pending.length, 0);
    assert.equal(LearningHttp.captureIdentity(), null);
});
