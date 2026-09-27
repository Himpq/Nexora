// Node >= 22.13; runs production ETS logic with deterministic native-adapter stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');
const main = path.resolve(__dirname, '../entry/src/main');
const ets = path.join(main, 'ets');

function load(relative, names, bindings = {}) {
    const source = fs.readFileSync(path.join(ets, relative + '.ets'), 'utf8')
        .replace(/^import\s[\s\S]*?;\r?\n/gm, '')
        .replace(/^@Observed\r?\n/gm, '')
        .replace(/@InsightIntentEntry\([\s\S]*?\)\r?\n(?=export default class)/, '')
        .replace(/^export default /gm, '').replace(/^export\s/gm, '');
    return new Function(...Object.keys(bindings), stripTypeScriptTypes(source) + '\nreturn { ' + names.join(',') + ' };')(
        ...Object.values(bindings));
}

const memory = new Map();
const appStorage = new Map();
const writes = [];
const requests = [];
const responses = [];
const forms = [];
const store = { getSync: (key, fallback) => memory.get(key) ?? fallback, putSync: (key, value) => memory.set(key, value) };
let identity = null;
let cookie = '';
let supported = true;
let destroyed = 0;
let backendUrl = 'https://chat.example';
let runtimeResult = null;
const context = {};
const AppStorage = {
    get: (key) => appStorage.get(key),
    setOrCreate(key, value) { writes.push(key); appStorage.set(key, value); },
};
const HttpUtil = {
    hasSession: () => cookie.length > 0,
    getSessionCookie: () => cookie,
    getBackendUrl: () => backendUrl,
    setBackendUrl: (url) => { backendUrl = url; },
    async logout() { cookie = ''; },
};
const hilog = { info() {}, warn() {}, error() {} };
const { Json } = load('common/JsonUtil', ['Json']);
const { LearningSystemEntry } = load('common/LearningSystemEntry', ['LearningSystemEntry'], {
    Json, AppStorage, HttpUtil,
    LearningHttp: { captureIdentity: () => identity },
    preferences: {
        StorageType: { GSKV: 1 }, isStorageTypeSupported: () => supported,
        getPreferencesSync(ctx, options) { assert.equal(options.storageType, 1); return store; },
    },
    formBindingData: { createFormBindingData: (data) => data },
    formProvider: { async updateForm(id, data) { forms.push({ id, data }); } },
    hilog,
});
const { AppState } = load('common/AppState', ['AppState'], {
    Json, AppStorage, HttpUtil, LearningSystemEntry, hilog,
    DEFAULT_BACKEND_URL: 'https://chat.example',
    ApiService: { async fetchLearningRuntime() { return runtimeResult; } },
    LearningApi: { shared: {
        configure(username, serviceBase = '') {
            identity = username.length > 0 && serviceBase.length > 0 ?
                { username, serviceBase, scope: 'scope_' + username, revision: 1 } : null;
        },
    } },
    PreferencesUtil: { async saveBackendUrl() {}, async clearSession() {} },
});
const { LearningFormClient } = load('common/LearningFormClient', ['LearningFormClient'], {
    LearningSystemEntry, Json,
    http: {
        RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 1 },
        createHttp() {
            return {
                async request(url, options) {
                    requests.push({ url, ...options });
                    assert.ok(responses.length, 'unexpected network call');
                    const next = responses.shift();
                    if (next.beforeReturn) await next.beforeReturn();
                    if (next.error) throw new Error('offline');
                    return { responseCode: next.status, result: JSON.stringify(next.payload) };
                },
                destroy() { destroyed++; },
            };
        },
    },
});

function reset() {
    memory.clear(); appStorage.clear(); writes.length = 0; requests.length = 0;
    responses.length = 0; forms.length = 0; identity = null; cookie = ''; supported = true; destroyed = 0;
    backendUrl = 'https://chat.example'; runtimeResult = null;
}

function authenticatedApp() {
    const app = new AppState();
    app.context = context;
    app.username = identity.username;
    app.backendUrl = backendUrl;
    app.loggedIn = true;
    app.learningEnabled = true;
    app.learningFrontendUrl = identity.serviceBase;
    return app;
}

function authorize(username = 'real-user') {
    identity = { username, serviceBase: 'https://learning.example', scope: 'scope_' + username, revision: 1 };
    cookie = 'session=' + username;
    appStorage.set('nxSessionReady', true);
    LearningSystemEntry.prepare(context);
    return LearningSystemEntry.readIdentity(context);
}

function entry(id, ts = 1, status = 'pending') {
    return { id, ts, status, kind: 'agent_msg', text: '学习安排 ' + id,
        card: {}, actions: [{ action: 'decision_accept' }, { action: 'decision_defer' }] };
}

async function publish(entries = [entry('decision-1')]) {
    await LearningSystemEntry.updateToday(context, { focus: { chapter_name: '第三章' }, today: { study_minutes: 8 } }, entries);
    const data = LearningSystemEntry.card(context);
    return { response: 'accept', decisionId: data.decisionId, identityToken: data.identityToken };
}

const validSession = () => ({ status: 200, payload: { success: true, user: { id: identity.username } } });
const success = { status: 200, payload: { success: true, data: { updated: true } } };

test('launches remain pending before login, and repeated routes carry a new token', () => {
    reset();
    LearningSystemEntry.requestLaunch('review', 'decision-1');
    assert.deepEqual(writes, ['nxLaunchDecision', 'nxLaunchRoute', 'nxLaunchToken']);
    assert.equal(appStorage.get('nxLaunchRoute'), 'review');
    assert.equal(appStorage.get('nxSessionReady'), undefined);
    LearningSystemEntry.requestLaunch('review', 'decision-2');
    assert.equal(appStorage.get('nxLaunchToken'), 2);
    assert.equal(appStorage.get('nxLaunchDecision'), 'decision-2');
    LearningSystemEntry.requestLaunch('unrecognized');
    assert.equal(appStorage.get('nxLaunchToken'), 2);
    assert.equal(requests.length, 0);
});

test('both registered intents only enqueue routes and never issue pre-login requests', async () => {
    reset();
    class Executor {}
    for (const [name, route] of [['WhatsNextIntent', 'day'], ['QuizMeIntent', 'review']]) {
        const loaded = load('intents/' + name, [name], { LearningSystemEntry, AppStorage, InsightIntentEntryExecutor: Executor });
        const result = await new loaded[name]().onExecute();
        assert.equal(result.code, 0);
        assert.match(result.result, /登录/);
        assert.equal(appStorage.get('nxLaunchRoute'), route);
    }
    assert.equal(requests.length, 0);
});

test('stored display names and unvalidated cookies do not authorize card writes', () => {
    reset();
    identity = { username: 'prefilled', serviceBase: 'https://learning.example' };
    cookie = 'session=unvalidated';
    LearningSystemEntry.prepare(context);
    assert.equal(LearningSystemEntry.readIdentity(context), null);
    appStorage.set('nxSessionReady', true);
    cookie = '';
    LearningSystemEntry.prepare(context);
    assert.equal(LearningSystemEntry.readIdentity(context), null);
    cookie = 'session=valid'; supported = false;
    LearningSystemEntry.prepare(context);
    assert.equal(LearningSystemEntry.readIdentity(context), null);
});

test('only the verified real identity is shared and account changes revoke old card tokens', async () => {
    reset();
    const before = authorize();
    const action = await publish();
    assert.equal(before.username, 'real-user');
    assert.equal(before.serviceBase, 'https://learning.example');
    assert.equal(before.backendUrl, 'https://chat.example');
    authorize();
    assert.equal(LearningSystemEntry.readIdentity(context).token, before.token, 'normal refreshes keep in-flight operations valid');
    const after = authorize('second-user');
    assert.notEqual(after.token, before.token);
    assert.equal(LearningSystemEntry.isCurrent(context, before), false);
    await LearningFormClient.respond(context, action);
    assert.equal(requests.length, 0);
});

test('card event parsing requires an exact action plus its displayed decision and account token', () => {
    reset();
    for (const text of ['accept', '{bad json}', '[]', '{"message":"accept"}',
        '{"response":"dont-accept","decision_id":"a","identity_token":"b"}',
        '{"response":"defer","decision_id":"a"}']) {
        assert.equal(LearningSystemEntry.parseAction(text), null);
    }
    assert.deepEqual(LearningSystemEntry.parseAction('{"response":"defer","decision_id":"a","identity_token":"b"}'),
        { response: 'defer', decisionId: 'a', identityToken: 'b' });
});

test('only the latest pending actionable decision is published, stale card clicks are rejected', async () => {
    reset(); authorize();
    const first = await publish();
    const second = await publish([entry('old', 1), entry('new', 4), entry('done', 5, 'accept')]);
    assert.equal(second.decisionId, 'new');
    await LearningFormClient.respond(context, first);
    assert.equal(requests.length, 0);
    assert.equal(LearningSystemEntry.card(context).minutes, '今日已学 8 分钟');
});

test('expired or mismatched backend sessions cannot write learning decisions', async () => {
    for (const response of [{ status: 401, payload: {} }, { status: 404, payload: {} },
        { status: 200, payload: { success: true, user: { id: 'some-other-user' } } }]) {
        reset(); authorize();
        const action = await publish();
        responses.push(response);
        const result = await LearningFormClient.respond(context, action);
        assert.equal(result.retry, false);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, 'GET');
        assert.equal(LearningSystemEntry.readIdentity(context), null);
    }
});

test('accept and defer use the actual API contract, refresh every card, and cannot be replayed', async () => {
    for (const response of ['accept', 'defer']) {
        reset(); authorize();
        LearningSystemEntry.rememberForm(context, 'form-a');
        LearningSystemEntry.rememberForm(context, 'form-b');
        const action = await publish(); action.response = response;
        responses.push(validSession(), success);
        await LearningFormClient.respond(context, action);
        assert.deepEqual(requests.map((request) => [request.method, request.url]), [
            ['GET', 'https://chat.example/api/user/info?lite=1'],
            ['POST', 'https://learning.example/api/agent/v1/decision/respond'],
        ]);
        assert.deepEqual(JSON.parse(requests[1].extraData), { decision_id: 'decision-1', response });
        assert.equal(requests[1].header['X-Nexora-Username'], 'real-user');
        assert.equal(requests[1].header.Cookie, 'session=real-user');
        assert.equal(destroyed, 2);
        assert.equal(LearningSystemEntry.card(context).actionable, false);
        assert.deepEqual(new Set(forms.map((form) => form.id)), new Set(['form-a', 'form-b']));
        await LearningFormClient.respond(context, action);
        assert.equal(requests.length, 2);
        await publish([entry('decision-1')]);
        assert.equal(LearningSystemEntry.card(context).actionable, false, 'an older /events response cannot resurrect the decision');
        assert.equal(appStorage.get('nxLaunchRoute'), undefined, 'card replies do not navigate the UI');
    }
});

test('transient errors retain the decision and business failures are never shown as sent', async () => {
    for (const response of [{ error: true }, { status: 503, payload: {} },
        { status: 200, payload: { success: false, error: 'unavailable' } }]) {
        reset(); authorize();
        const action = await publish();
        responses.push(validSession(), response);
        const result = await LearningFormClient.respond(context, action);
        assert.equal(result.retry, true);
        assert.equal(LearningSystemEntry.card(context).decisionId, action.decisionId);
        assert.equal(LearningSystemEntry.card(context).actionable, true);
    }
});

test('logout or account switching during async validation prevents the following POST', async () => {
    for (const invalidate of [() => LearningSystemEntry.clear(context), () => authorize('next-user')]) {
        reset(); authorize();
        const action = await publish();
        responses.push({ ...validSession(), beforeReturn: invalidate });
        await LearningFormClient.respond(context, action);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, 'GET');
    }
});

test('late responses after logout cannot restore old account state', async () => {
    reset(); authorize();
    const action = await publish();
    responses.push(validSession(), { ...success, beforeReturn: () => LearningSystemEntry.clear(context) });
    await LearningFormClient.respond(context, action);
    assert.equal(LearningSystemEntry.readIdentity(context), null);
    assert.equal(LearningSystemEntry.card(context).actionable, false);
    assert.equal(memory.get('card'), '');
});

test('AppState backend changes synchronously revoke persistent card credentials', async () => {
    reset(); authorize();
    const action = await publish();
    const app = authenticatedApp();
    const update = app.updateBackendUrl('https://different-chat.example');
    assert.equal(LearningSystemEntry.readIdentity(context), null);
    assert.equal(LearningSystemEntry.card(context).actionable, false);
    await LearningFormClient.respond(context, action);
    assert.equal(requests.length, 0, 'the old backend cookie must never reach a form request');
    await update;
});

test('AppState disables old card writes on unavailable, disabled, or changed runtime configuration', async () => {
    for (const result of [
        { success: false, message: 'unavailable', enabled: false, frontendUrl: '' },
        { success: true, message: '', enabled: false, frontendUrl: 'https://learning.example' },
        { success: true, message: '', enabled: true, frontendUrl: 'https://different-learning.example' },
    ]) {
        reset(); authorize();
        const action = await publish();
        const app = authenticatedApp();
        runtimeResult = result;
        await app.refreshLearningRuntime();
        assert.equal(LearningSystemEntry.readIdentity(context), null);
        assert.equal(LearningSystemEntry.card(context).actionable, false);
        await LearningFormClient.respond(context, action);
        assert.equal(requests.length, 0, 'revoked form identities cannot call their old service');
    }
});

test('a runtime refresh with the same identity preserves the current card action', async () => {
    reset(); const savedIdentity = authorize();
    const action = await publish();
    const app = authenticatedApp();
    runtimeResult = { success: true, message: '', enabled: true, frontendUrl: identity.serviceBase };
    await app.refreshLearningRuntime();
    assert.equal(LearningSystemEntry.readIdentity(context).token, savedIdentity.token);
    responses.push(validSession(), success);
    await LearningFormClient.respond(context, action);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].method, 'POST');
});

test('AppState logout revokes a card even while its session validation is in flight', async () => {
    reset(); authorize();
    const action = await publish();
    const app = authenticatedApp();
    responses.push({ ...validSession(), beforeReturn: () => app.signOut() });
    await LearningFormClient.respond(context, action);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(LearningSystemEntry.readIdentity(context), null);
    assert.equal(LearningSystemEntry.card(context).actionable, false);
});

test('a completed older request does not overwrite a newly published decision', async () => {
    reset(); authorize();
    const action = await publish();
    responses.push(validSession(), { ...success, beforeReturn: () => publish([entry('new-decision', 2)]) });
    await LearningFormClient.respond(context, action);
    assert.equal(LearningSystemEntry.card(context).decisionId, 'new-decision');
});

test('forms and intents are declared with existing resources and INTERNET permission', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(main, 'module.json5'), 'utf8').replace(/,\s*([}\]])/g, '$1')).module;
    assert.ok(manifest.requestPermissions.some((item) => item.name === 'ohos.permission.INTERNET'));
    const extension = manifest.extensionAbilities.find((item) => item.name === 'EntryFormAbility');
    assert.equal(extension.type, 'form'); assert.equal(extension.exported, false);
    assert.ok(extension.metadata.some((item) => item.name === 'ohos.extension.form' && item.resource === '$profile:form_config'));
    assert.ok(fs.existsSync(path.join(main, extension.srcEntry)));
    const config = JSON.parse(fs.readFileSync(path.join(main, 'resources/base/profile/form_config.json'), 'utf8'));
    assert.ok(fs.existsSync(path.join(main, config.forms[0].src)));
    const registry = fs.readFileSync(path.join(ets, 'intents/index.ets'), 'utf8');
    assert.match(registry, /WhatsNextIntent/); assert.match(registry, /QuizMeIntent/);
    for (const name of ['WhatsNextIntent', 'QuizMeIntent']) {
        const source = fs.readFileSync(path.join(ets, 'intents/' + name + '.ets'), 'utf8');
        assert.match(source, /@InsightIntentEntry/);
        assert.match(source, /UI_ABILITY_FOREGROUND/);
        assert.doesNotMatch(source, /HeadlessApi|NxEnv|loadContent\(/);
    }
});
