const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../entry/src/main/ets');
function load(relative, name, bindings = {}) {
    const source = fs.readFileSync(path.join(root, relative + '.ets'), 'utf8')
        .replace(/^import\s[\s\S]*?;\r?\n/gm, '').replace(/^export\s/gm, '');
    return new Function(...Object.keys(bindings), stripTypeScriptTypes(source) + '\nreturn ' + name)(...Object.values(bindings));
}
const Json = load('common/JsonUtil', 'Json');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const callbacks = { onText() {}, onState() {}, onLevel() {} };
function fixture() {
    const values = new Map(), requests = [], forms = [], notifications = [], cancelled = [];
    let learning = { username: 'alice', serviceBase: 'https://learning.example' };
    let cookie = 'session=alice', enabled = true, notificationFailure = false, beforePublish = null;
    let transport = async () => { throw new Error('unexpected request'); };
    const context = { applicationInfo: { accessTokenId: 1 } };
    const notificationManager = {
        async cancelGroup(group) { cancelled.push({ group }); },
        async isNotificationEnabled() { return enabled; },
        async requestEnableNotification() {},
        async publish(value) {
            if (notificationFailure) throw new Error('native publish failed');
            notifications.push(value);
            if (beforePublish) await beforePublish();
        },
        async cancel(id, label) { cancelled.push({ id, label }); },
        SlotType: { SERVICE_INFORMATION: 4 }, ContentType: { NOTIFICATION_CONTENT_BASIC_TEXT: 0 },
    };
    const system = load('common/LearningSystemEntry', 'LearningSystemEntry', {
        Json, notificationManager, AppStorage: { get: () => true, setOrCreate() {} },
        LearningHttp: { captureIdentity: () => learning },
        HttpUtil: { hasSession: () => !!cookie, getSessionCookie: () => cookie, getBackendUrl: () => 'https://chat.example' },
        preferences: { StorageType: { GSKV: 1 }, isStorageTypeSupported: () => true,
            getPreferencesSync: () => ({ getSync: (key, fallback) => values.get(key) ?? fallback, putSync: (key, value) => values.set(key, value) }) },
        formProvider: { async updateForm(id, value) { forms.push({ id, value }); } },
        formBindingData: { createFormBindingData: value => value }, hilog: { warn() {} },
    });
    system.prepare(context);
    system.rememberForm(context, 'card-1');
    const client = load('common/LearningFormClient', 'LearningFormClient', {
        Json, LearningSystemEntry: system,
        http: { RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 1 },
            createHttp: () => ({ async request(url, options) { requests.push({ url, options }); return transport(url, options); }, destroy() {} }) },
    });
    const controller = load('common/LearningAgentNotification', 'LearningAgentNotification', {
        LearningSystemEntry: system, notificationManager,
        wantAgent: { OperationType: { START_ABILITY: 1 }, WantAgentFlags: { UPDATE_PRESENT_FLAG: 4 },
            async getWantAgent(options) { return options; } },
    });
    return { values, requests, forms, notifications, cancelled, system, client, controller, context,
        identity: () => system.readIdentity(context),
        switchUser() { learning = { ...learning, username: 'bob' }; cookie = 'session=bob'; system.prepare(context); },
        transport(value) { transport = value; }, permission(value) { enabled = value; },
        failure(value) { notificationFailure = value; }, beforePublish(value) { beforePublish = value; },
    };
}
const today = { focus: null, today: { study_minutes: 8, completed_chapters: 1 } };
const entry = (id = 'd1', extra = {}) => ({ id, ts: Date.now(), kind: 'agent_msg', text: '复习今天的章节',
    channel: 'notify', status: 'pending', card: { type: 'proactive' }, actions: [{ action: 'decision_accept' }], ...extra });
const response = data => ({ responseCode: 200, result: JSON.stringify({ success: true, data }) });
const session = () => ({ responseCode: 200, result: JSON.stringify({ success: true, user: { id: 'alice' } }) });

test('a form independently authenticates and fetches today/events through the cookie proxy', async () => {
    const f = fixture();
    f.transport(async url => url.includes('/user/info') ? session() : url.includes('/today') ? response(today) : response({ entries: [entry()] }));
    const snapshot = await f.client.refresh(f.context);
    assert.ok(snapshot);
    assert.deepEqual(f.requests.map(r => r.url), ['https://chat.example/api/user/info?lite=1',
        'https://chat.example/api/learning/agent/today', 'https://chat.example/api/learning/agent/events?limit=120']);
    assert.ok(f.requests.every(r => r.options.header.Cookie === 'session=alice' && !r.options.header['X-Nexora-Username']));
    assert.equal(f.system.card(f.context).decisionId, 'd1');
    assert.ok(f.forms.some(row => row.id === 'card-1' && row.value.actionable));
});

test('an identity change during card refresh prevents old results and the next request', async () => {
    const f = fixture();
    f.transport(async url => {
        if (url.includes('/user/info')) return session();
        f.switchUser(); return response(today);
    });
    assert.equal(await f.client.refresh(f.context), null);
    assert.equal(f.requests.length, 2);
    assert.equal(f.system.card(f.context).actionable, false);
});

test('invalid sessions revoke card identity and cannot query the learning proxy', async () => {
    const f = fixture(); f.transport(async () => ({ responseCode: 401, result: '{}' }));
    assert.equal(await f.client.refresh(f.context), null);
    assert.equal(f.identity(), null); assert.equal(f.requests.length, 1);
});

test('network failure preserves same-day data while a cross-day cache cannot still be accepted', async () => {
    const f = fixture(); await f.system.saveToday(f.context, f.identity(), today, [entry()]);
    f.transport(async () => { throw new Error('offline'); });
    await f.client.refresh(f.context);
    assert.equal(f.system.card(f.context).actionable, true);
    f.values.set('card_day', '2000-1-1');
    const cached = f.system.card(f.context);
    assert.equal(cached.actionable, false); assert.equal(cached.minutes, '');
    assert.equal(f.system.accepts(f.context, f.identity(), { response: 'accept', decisionId: 'd1', identityToken: f.identity().token }), false);
});

test('an older refresh cannot replace the card already saved by a newer refresh', async () => {
    const f = fixture(), owner = f.identity(), now = Date.now();
    await f.system.saveToday(f.context, owner, today, [entry('new')], now);
    await f.system.saveToday(f.context, owner, today, [entry('old')], now - 1);
    assert.equal(f.system.card(f.context).decisionId, 'new');
});

test('notifications require permission and only dispatch fresh notify decisions', async () => {
    const f = fixture();
    const hidden = [entry('card', { channel: 'card' }), entry('hold', { suppressed_by: 'silent_hours' }),
        entry('dnd', { context: { dnd: true } }), entry('old', { ts: Date.now() - 86400001 }), entry('done', { status: 'accept' })];
    await f.controller.publishLatest(f.context, f.identity(), hidden);
    assert.equal(f.notifications.length, 0);
    f.permission(false); await f.controller.publishLatest(f.context, f.identity(), [entry()]);
    assert.equal(f.notifications.length, 0); assert.equal(f.system.wasNotified(f.context, f.identity(), 'd1'), false);
    f.permission(true); await f.controller.publishLatest(f.context, f.identity(), [entry()]);
    assert.equal(f.notifications.length, 1);
    const request = f.notifications[0];
    assert.equal(request.notificationSlotType, 4, 'modern NotificationManager uses notificationSlotType');
    assert.equal(request.appMessageId, request.label, 'system deduplication also covers separate app/form processes');
    assert.equal(request.tapDismissed, true);
    assert.deepEqual(request.wantAgent.wants[0].parameters, { nx_route: 'day', decision_id: 'd1', nx_identity: f.identity().token });
    assert.equal(request.groupName, 'nexora_learning_' + f.identity().token);
});

test('notification receipts persist and concurrent publishes share one native delivery', async () => {
    const f = fixture(), wait = deferred(); f.beforePublish(() => wait.promise);
    const first = f.controller.publishLatest(f.context, f.identity(), [entry()]);
    await new Promise(resolve => setImmediate(resolve));
    await f.controller.publishLatest(f.context, f.identity(), [entry()]);
    wait.resolve(); await first;
    await f.controller.publishLatest(f.context, f.identity(), [entry()]);
    assert.equal(f.notifications.length, 1); assert.ok(JSON.parse(f.values.get('notified')).includes('d1'));
});

test('native notification failure can retry, and accepting a card suppresses a pending notification', async () => {
    const f = fixture(); f.failure(true);
    await f.controller.publishLatest(f.context, f.identity(), [entry()]);
    assert.equal(f.system.wasNotified(f.context, f.identity(), 'd1'), false);
    f.failure(false); await f.controller.publishLatest(f.context, f.identity(), [entry()]);
    await f.system.saveToday(f.context, f.identity(), today, [entry('d2')]);
    await f.system.finishDecision(f.context, f.identity(), { response: 'accept', decisionId: 'd2', identityToken: f.identity().token });
    await f.controller.publishLatest(f.context, f.identity(), [entry('d2')]);
    assert.equal(f.notifications.length, 1);
});

test('logout during native delivery cancels only the notification of the previous identity', async () => {
    const f = fixture(), old = f.identity(); f.beforePublish(async () => f.switchUser());
    await f.controller.publishLatest(f.context, old, [entry()]);
    assert.ok(f.cancelled.some(row => row.id && row.label === old.token + ':d1'));
    assert.equal(f.system.wasNotified(f.context, f.identity(), 'd1'), false);
});

function deviceFixture({ granted = false, supported = true, events = [] } = {}) {
    const sent = [];
    const Device = load('common/LearningDeviceContext', 'LearningDeviceContext', {
        canIUse: () => supported,
        abilityAccessCtrl: { GrantStatus: { PERMISSION_GRANTED: 0 }, createAtManager: () => ({
            checkAccessTokenSync: () => granted ? 0 : -1, async requestPermissionsFromUser() { return { authResults: [granted ? 0 : -1] }; } }) },
        calendarManager: { EventFilter: { filterByTime: (start, end) => ({ start, end }) },
            getCalendarManager: () => ({ async getAllCalendars() { return [{ async getEvents() { return events; } }]; } }) },
        LearningSystemEntry: { readIdentity: () => ({ token: 'alice' }), isCurrent: () => true },
        LearningFormClient: { async reportDevice(ctx, owner, payload) { sent.push(payload); return true; } },
    });
    return { Device, sent, context: { applicationInfo: { accessTokenId: 1 } } };
}

test('device context never invents DND or an empty full calendar when permission is absent', async () => {
    const f = deviceFixture(); const payload = await f.Device.collect(f.context, false);
    assert.equal(payload.foreground, false); assert.equal(payload.scene, 'app_background');
    assert.equal(payload.dnd_status, 'unavailable'); assert.equal(Object.hasOwn(payload, 'do_not_disturb'), false);
    assert.equal(payload.calendar_status, 'unavailable'); assert.equal(payload.calendar_reason, 'permission_denied');
    assert.ok(payload.sampled_at_ms > 0);
});

test('granted calendar access reports real sorted events and declares its limited scope', async () => {
    const f = deviceFixture({ granted: true, events: [{ title: 'later', startTime: Date.now() + 60000 },
        { title: 'earlier', startTime: Date.now() + 20000 }, { title: 'past', startTime: 1 }] });
    const payload = await f.Device.collect(f.context, true);
    assert.equal(payload.calendar_status, 'partial'); assert.equal(payload.calendar_reason, 'app_calendar_only');
    assert.deepEqual(payload.calendar.map(row => row.title), ['earlier', 'later']);
    await f.Device.report(f.context, true); await f.Device.report(f.context, true); await f.Device.report(f.context, false);
    assert.equal(f.sent.length, 2, 'same-state updates are throttled, foreground changes are immediate');
});

test('voice cancellation during permission prevents a later microphone startup', async () => {
    const permission = deferred(); let engines = 0;
    const Voice = load('common/VoiceRecognizerService', 'VoiceRecognizerService', { canIUse: () => true,
        speechRecognizer: { async createEngine() { engines++; } }, audio: {}, hilog: { error() {}, info() {} } });
    const voice = new Voice(); voice.requestMicrophonePermission = () => permission.promise;
    const starting = voice.start({}, callbacks); voice.cancel(); permission.resolve(true); await starting;
    assert.equal(engines, 0); assert.equal(voice.active, false); assert.equal(voice.starting, false);
});

test('a voice engine created after cancellation is closed before audio capture', async () => {
    const engine = deferred(); let shutdown = 0, capture = 0;
    const Voice = load('common/VoiceRecognizerService', 'VoiceRecognizerService', { canIUse: () => true,
        speechRecognizer: { createEngine: () => engine.promise }, audio: { async createAudioCapturer() { capture++; } },
        hilog: { error() {}, info() {} } });
    const voice = new Voice(); voice.requestMicrophonePermission = async () => true;
    const starting = voice.start({}, callbacks); await new Promise(resolve => setImmediate(resolve)); voice.cancel();
    engine.resolve({ shutdown() { shutdown++; } }); await starting;
    assert.equal(shutdown, 1); assert.equal(capture, 0);
});
