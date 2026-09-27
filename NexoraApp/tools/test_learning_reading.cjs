/* node --test tools/test_learning_reading.cjs
 * Runs production ArkTS state, PreferencesUtil, LearningHttp and API code with
 * deterministic storage/network seams. Does not assert ArkUI rendering.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require(process.env.NEXORA_TYPESCRIPT_PATH ||
  'C:/Program Files/Huawei/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript/lib/typescript.js');
const sourceRoot = path.resolve(__dirname, '../entry/src/main/ets/common');

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

function environment(saved = new Map()) {
  let now = Date.UTC(2026, 8, 26, 10);
  let flushCount = 0;
  let flushGate = null;
  let flushFrom = 1;
  let flushFails = false;
  let putFails = false;
  let handler = async () => ({ status: 200, body: { success: true } });
  let storageObserver = () => {};
  const cache = new Map(saved);
  const disk = new Map(saved);
  const storage = new Map();
  const requests = [];
  const logs = [];
  const flushWaiters = new Map();
  const requestWaiters = new Map();
  const context = {};
  const prefs = {
    async get(key, fallback) { return cache.has(key) ? cache.get(key) : fallback; },
    async put(key, value) {
      if (putFails) throw new Error('fixture put failure');
      cache.set(key, value);
    },
    async flush() {
      flushCount++;
      flushWaiters.get(flushCount)?.();
      if (flushGate && flushCount >= flushFrom) await flushGate;
      if (flushFails) throw new Error('fixture flush failure');
      for (const [key, value] of cache) disk.set(key, value);
    },
  };
  const HttpUtil = {
    pathForLog: value => value,
    async get(url, headers) { return HttpUtil.send('GET', url, null, headers); },
    async post(url, body, headers) { return HttpUtil.send('POST', url, body, headers); },
    async send(method, url, body, headers) {
      const request = { method, url, body: body === null ? null : JSON.parse(JSON.stringify(body)), headers: { ...headers } };
      requests.push(request);
      requestWaiters.get(requests.length)?.();
      const response = await handler(request);
      return { ok: response.status === 200, code: response.status, body: JSON.stringify(response.body) };
    },
  };
  const hilog = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (...args) => logs.push({ level, args })]));
  const AppStorage = { get: key => storage.get(key), setOrCreate: (key, value) => {
    storage.set(key, value);
    storageObserver(key, value);
  } };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const modules = new Map();
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const filename = path.join(sourceRoot, name + '.ets');
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }, fileName: filename,
    });
    const exported = {};
    modules.set(name, exported);
    vm.runInNewContext(result.outputText, {
      exports: exported, Date: Clock, AppStorage, console,
      require(specifier) {
        if (specifier === './HttpUtil') return { HttpUtil };
        if (specifier === './AppConfig') return { StorageKey: {} };
        if (specifier === '@kit.PerformanceAnalysisKit') return { hilog };
        if (specifier === '@ohos.data.preferences') return { default: { getPreferences: async () => prefs } };
        if (specifier.startsWith('./')) return load(specifier.slice(2));
        return {};
      },
    }, { filename });
    return exported;
  }
  const { LearningHttp } = load('LearningHttp');
  LearningHttp.configure('reader_a', 'https://learning-a.invalid/api/frontend/');
  const state = load('LearningReading');
  const { LearningReadingApi: api } = load('LearningReadingApi');
  const { LearningBridge: bridge } = load('LearningBridge');
  return {
    state, api, bridge, LearningHttp, context, cache, disk, storage, requests, logs,
    setHandler(value) { handler = value; },
    observeStorage(observer) { storageObserver = observer; },
    setNow(value) { now = value; },
    setFlushFailure(value) { flushFails = value; },
    setPutFailure(value) { putFails = value; },
    setFlushGate(value, from = 1) { flushGate = value; flushFrom = from; },
    waitFlush(count) { return flushCount >= count ? Promise.resolve() : new Promise(resolve => flushWaiters.set(count, resolve)); },
    waitRequest(count = 1) { return requests.length >= count ? Promise.resolve() : new Promise(resolve => requestWaiters.set(count, resolve)); },
    async settle() { for (let index = 0; index < 80; index++) await Promise.resolve(); },
    point(sequence = 1, session = 'visit') {
      const point = new state.ReadingCheckpoint();
      point.lecture_id = 'lecture';
      point.book_id = 'book';
      point.chapter_name = 'Chapter 0';
      point.chapter_range = '100:1000';
      point.session_id = session;
      point.sequence = sequence;
      point.started_at_ms = now - 100000;
      point.observed_at_ms = now;
      point.active_duration_ms = sequence * 10000;
      point.read_ranges = [[100, 100 + sequence * 100]];
      return point;
    },
    pending(owner = LearningHttp.captureIdentity()) { return state.nxPendingReading(context, owner.scope); },
  };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('Unicode length counts non-BMP characters once and preserves lone surrogates', () => {
  const { state } = environment();
  assert.equal(state.nxCodePointLength('甲😀乙𠮷'), 4);
  assert.equal(state.nxCodePointLength('\ud800甲\udfff'), 3);
  assert.equal(state.nxCodePointLength(''), 0);
});

test('sessions count only visible time, qualify dwell at two seconds, and detach snapshots', () => {
  const env = environment();
  const point = env.point();
  point.started_at_ms = 100000;
  point.active_duration_ms = 0;
  point.read_ranges = [];
  point.sequence = 0;
  const session = new env.state.ReadingSession(point);
  session.enterPage([[100, 200]], true, 100000);
  assert.deepEqual(plain(session.snapshot(0, 0, 101999).read_ranges), []);
  const first = session.snapshot(0, 0, 102000);
  assert.equal(first.active_duration_ms, 2000);
  assert.deepEqual(plain(first.read_ranges), [[100, 200]]);
  session.setActive(false, 103000);
  session.setActive(true, 903000);
  session.enterPage([[300, 400]], true, 903000);
  session.enterPage([[500, 600]], true, 903500);
  const last = session.snapshot(2, 2, 906000);
  assert.equal(last.active_duration_ms, 6000);
  assert.deepEqual(plain(last.read_ranges), [[100, 200], [500, 600]]);
  assert.equal(first.active_duration_ms, 2000);
  assert.deepEqual(plain(first.read_ranges), [[100, 200]]);
  assert.notEqual(first.sequence, last.sequence);
});

test('an overlay interrupts the two-second same-page dwell requirement', () => {
  const env = environment();
  const point = env.point();
  point.started_at_ms = 10000;
  point.active_duration_ms = 0;
  point.read_ranges = [];
  const session = new env.state.ReadingSession(point);
  session.enterPage([[100, 200]], true, 10000);
  session.setActive(false, 11000);
  session.setActive(true, 20000);
  assert.deepEqual(plain(session.snapshot(0, 0, 21000).read_ranges), []);
  assert.deepEqual(plain(session.snapshot(0, 0, 22000).read_ranges), [[100, 200]]);
  assert.equal(session.snapshot(0, 0, 22000).active_duration_ms, 3000);
});

test('offline checkpoints coalesce and survive process restart before retry', async () => {
  const env = environment();
  env.setHandler(async () => ({ status: 0, body: {} }));
  assert.equal(await env.api.queueReadingProgress(env.context, env.point(1)), 'pending');
  assert.equal(await env.api.queueReadingProgress(env.context, env.point(2)), 'pending');
  assert.deepEqual(Array.from(await env.pending(), point => point.sequence), [2]);
  const restarted = environment(env.disk);
  assert.equal(await restarted.api.flushReadingProgress(restarted.context), true);
  assert.equal(restarted.requests[0].body.sequence, 2);
  assert.equal((await restarted.pending()).length, 0);
  assert.equal(restarted.bridge.latest().type, 'reading_synced');
});

for (const change of ['account', 'service']) {
  test(`a stale checkpoint retains its original ${change} owner even when queued after switching`, async () => {
    const env = environment();
    const point = env.point();
    const owner = point.owner;
    env.LearningHttp.configure(change === 'account' ? 'reader_b' : 'reader_a',
      change === 'service' ? 'https://learning-b.invalid' : owner.serviceBase);
    assert.equal(await env.api.queueReadingProgress(env.context, point), 'pending');
    assert.equal(env.requests.length, 0);
    assert.equal((await env.pending()).length, 0);
    assert.equal((await env.pending(owner)).length, 1);
    env.LearningHttp.configure(owner.username, owner.serviceBase);
    assert.equal(await env.api.flushReadingProgress(env.context), true);
    assert.equal(env.requests[0].url, owner.serviceBase + '/api/frontend/learning/reading-progress');
    assert.equal(env.requests[0].headers['X-Nexora-Username'], owner.username);
  });

  test(`switching ${change} during the durable barrier prevents an old send`, async () => {
    const env = environment();
    const point = env.point();
    const gate = deferred();
    env.setFlushGate(gate.promise, 2);
    const pending = env.api.queueReadingProgress(env.context, point);
    await env.waitFlush(2);
    env.LearningHttp.configure(change === 'account' ? 'reader_b' : 'reader_a',
      change === 'service' ? 'https://learning-b.invalid' : point.owner.serviceBase);
    gate.resolve();
    assert.equal(await pending, 'pending');
    assert.equal(env.requests.length, 0);
    assert.equal((await env.pending(point.owner)).length, 1);
    assert.equal(env.bridge.latest(), null);
  });
}

test('an in-flight old-account ACK never touches the new account or publishes its event', async () => {
  const env = environment();
  const gate = deferred();
  env.setHandler(async request => {
    if (request.headers['X-Nexora-Username'] === 'reader_a') await gate.promise;
    return { status: 200, body: { success: true } };
  });
  const oldPoint = env.point();
  const pendingA = env.api.queueReadingProgress(env.context, oldPoint);
  await env.waitRequest();
  env.LearningHttp.configure('reader_b', oldPoint.owner.serviceBase);
  assert.equal(await env.api.queueReadingProgress(env.context, env.point()), 'synced');
  const newTick = env.bridge.latest().tick;
  gate.resolve();
  assert.equal(await pendingA, 'pending');
  assert.equal(env.bridge.latest().tick, newTick);
  assert.equal(env.bridge.latest().scope, env.LearningHttp.captureIdentity().scope);
  assert.equal((await env.pending(oldPoint.owner)).length, 0);
  assert.equal((await env.pending()).length, 0);
  assert.deepEqual(env.requests.map(request => request.headers['X-Nexora-Username']), ['reader_a', 'reader_b']);
});

test('only one drain runs per scope and an old ACK preserves a newer queued snapshot', async () => {
  const env = environment();
  const gate = deferred();
  env.setHandler(async () => { await gate.promise; return { status: 200, body: { success: true } }; });
  const first = env.api.queueReadingProgress(env.context, env.point(1));
  await env.waitRequest();
  const second = env.api.queueReadingProgress(env.context, env.point(2));
  await env.settle();
  assert.equal(env.requests.length, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ['synced', 'synced']);
  assert.deepEqual(env.requests.map(request => request.body.sequence), [1, 2]);
  assert.equal((await env.pending()).length, 0);
});

test('many enqueues during a slow failure share one request and retry only on the next trigger', async () => {
  const env = environment();
  const gate = deferred();
  env.setHandler(async () => { await gate.promise; return { status: 503, body: { success: false } }; });
  const calls = [env.api.queueReadingProgress(env.context, env.point(1))];
  await env.waitRequest();
  for (let sequence = 2; sequence <= 8; sequence++) calls.push(env.api.queueReadingProgress(env.context, env.point(sequence)));
  await env.settle();
  assert.equal(env.requests.length, 1);
  assert.deepEqual(Array.from(await env.pending(), point => point.sequence), [8]);
  gate.resolve();
  assert.ok((await Promise.all(calls)).every(status => status === 'pending'));
  assert.equal(env.requests.length, 1, 'failed transport must not immediately rerun for each waiting heartbeat');
  env.setHandler(async () => ({ status: 200, body: { success: true } }));
  assert.equal(await env.api.flushReadingProgress(env.context), true);
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[1].body.sequence, 8);
});

test('an enqueue after the active drain observed an empty queue is still sent by that flight', async () => {
  const env = environment();
  const observedEmpty = deferred();
  const releaseEmpty = deferred();
  const original = env.state.nxDurablePendingReading;
  let intercept = true;
  env.state.nxDurablePendingReading = async (...args) => {
    const pending = await original(...args);
    if (pending.length === 0 && intercept) {
      intercept = false;
      observedEmpty.resolve();
      await releaseEmpty.promise;
    }
    return pending;
  };
  const flush = env.api.flushReadingProgress(env.context);
  await observedEmpty.promise;
  const queued = env.api.queueReadingProgress(env.context, env.point());
  await env.settle();
  assert.equal(env.requests.length, 0);
  releaseEmpty.resolve();
  assert.deepEqual(await Promise.all([flush, queued]), [true, 'synced']);
  assert.equal(env.requests.length, 1);
  assert.equal((await env.pending()).length, 0);
});

test('returning to an account during its old request starts one fresh-identity drain after the old ACK', async () => {
  const env = environment();
  const gate = deferred();
  env.setHandler(async () => { await gate.promise; return { status: 200, body: { success: true } }; });
  const old = env.api.queueReadingProgress(env.context, env.point(1));
  await env.waitRequest();
  env.LearningHttp.configure('reader_b', 'https://learning-a.invalid');
  env.LearningHttp.configure('reader_a', 'https://learning-a.invalid');
  const recent = env.api.queueReadingProgress(env.context, env.point(2));
  await env.settle();
  assert.equal(env.requests.length, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([old, recent]), ['pending', 'synced']);
  assert.deepEqual(env.requests.map(request => request.body.sequence), [1, 2]);
  assert.equal((await env.pending()).length, 0);
});

test('queue persistence captures values before callers mutate a checkpoint', async () => {
  const env = environment();
  const gate = deferred();
  env.setFlushGate(gate.promise);
  env.setHandler(async () => ({ status: 503, body: { success: false } }));
  const point = env.point();
  const queued = env.api.queueReadingProgress(env.context, point);
  point.sequence = 9;
  point.read_ranges[0][1] = 999;
  gate.resolve();
  assert.equal(await queued, 'pending');
  assert.equal(env.requests[0].body.sequence, 1);
  assert.deepEqual(env.requests[0].body.read_ranges, [[100, 200]]);
});

for (const boundary of ['local', 'UTC']) {
  test(`${boundary} midnight retains both days, orders snapshots, and acknowledges only one day`, async () => {
    const env = environment();
    const midnight = boundary === 'local' ? new Date(2026, 8, 27).getTime() : Date.UTC(2026, 8, 27);
    const old = env.point(1);
    const later = env.point(2);
    old.started_at_ms = midnight - 100000;
    old.observed_at_ms = midnight - 1000;
    later.started_at_ms = old.started_at_ms;
    later.observed_at_ms = midnight + 1000;
    const scope = old.owner.scope;
    await env.state.nxQueueReading(env.context, scope, later);
    await env.state.nxQueueReading(env.context, scope, old);
    const pending = await env.state.nxDurablePendingReading(env.context, scope);
    assert.deepEqual(Array.from(pending, point => point.sequence), [1, 2]);
    await env.state.nxAcknowledgeReading(env.context, scope, pending[1]);
    assert.deepEqual(Array.from(await env.pending(), point => point.sequence), [1]);
  });
}

for (const status of [400, 404, 409]) {
  test(`${status} discards invalid progress and continues to a healthy later session`, async () => {
    const env = environment();
    const owner = env.LearningHttp.captureIdentity();
    await env.state.nxQueueReading(env.context, owner.scope, env.point(1, 'bad'));
    await env.state.nxQueueReading(env.context, owner.scope, env.point(1, 'good'));
    env.setHandler(async request => request.body.session_id === 'bad'
      ? { status, body: { success: false, error: 'invalid visit' } }
      : { status: 200, body: { success: true } });
    assert.equal(await env.api.flushReadingProgress(env.context), false);
    assert.deepEqual(env.requests.map(request => request.body.session_id), ['bad', 'good']);
    assert.equal((await env.pending()).length, 0);
    assert.ok(env.logs.some(log => log.level === 'warn' && log.args.includes(status)));
    assert.equal(env.bridge.latest().type, 'reading_synced');
    assert.equal(await env.api.flushReadingProgress(env.context), true);
  });
}

test('a rejected historical checkpoint cannot misreport a healthy current checkpoint as unsaved', async () => {
  const env = environment();
  const owner = env.LearningHttp.captureIdentity();
  await env.state.nxQueueReading(env.context, owner.scope, env.point(1, 'bad-history'));
  env.setHandler(async request => request.body.session_id === 'bad-history'
    ? { status: 400, body: { success: false, error: 'chapter changed' } }
    : { status: 200, body: { success: true } });
  const result = await env.api.saveReadingProgress(env.context, env.point(1, 'current'));
  assert.equal(result.saved, true);
  assert.equal(result.status, 'failed');
  assert.deepEqual(env.requests.map(request => request.body.session_id), ['bad-history', 'current']);
  assert.equal((await env.pending()).length, 0);
  env.setPutFailure(true);
  assert.equal((await env.api.saveReadingProgress(env.context, env.point(2))).saved, false);
});

for (const status of [0, 401, 429, 503]) {
  test(`${status} retains durable progress for a later retry`, async () => {
    const env = environment();
    env.setHandler(async () => ({ status, body: { success: false, error: 'retry later' } }));
    assert.equal(await env.api.queueReadingProgress(env.context, env.point()), 'pending');
    assert.equal((await env.pending()).length, 1);
    assert.equal(env.bridge.latest(), null);
    env.setHandler(async () => ({ status: 200, body: { success: true, already_recorded: true } }));
    assert.equal(await env.api.flushReadingProgress(env.context), true);
    assert.equal((await env.pending()).length, 0);
  });
}

test('HTTP 200 with an unsuccessful business payload does not acknowledge the snapshot', async () => {
  const env = environment();
  env.setHandler(async () => ({ status: 200, body: { success: false, error: 'temporary problem' } }));
  assert.equal(await env.api.queueReadingProgress(env.context, env.point()), 'pending');
  assert.equal((await env.pending()).length, 1);
});

test('a transport exception retains saved reading as pending', async () => {
  const env = environment();
  env.setHandler(async () => { throw new Error('fixture connection aborted'); });
  assert.equal(await env.api.queueReadingProgress(env.context, env.point()), 'pending');
  assert.equal((await env.pending()).length, 1);
  assert.equal(env.storage.get('nxReadingSyncStatus'), 'pending');
});

test('scope keys cannot collide when service and username both contain underscores', () => {
  const env = environment();
  env.LearningHttp.configure('reader', 'https://fixture.invalid/api_');
  const first = env.LearningHttp.captureIdentity();
  env.LearningHttp.configure('_reader', 'https://fixture.invalid/api');
  const second = env.LearningHttp.captureIdentity();
  assert.notEqual(first.scope, second.scope);
});

test('identity revisions notify after updating runtime identity and ignore identical configuration', () => {
  const env = environment();
  const observed = [];
  env.observeStorage((key, value) => {
    if (key === 'nxLearningIdentityRevision') observed.push({ revision: value, owner: env.LearningHttp.captureIdentity() });
  });
  env.LearningHttp.configure('reader_b', 'https://learning-b.invalid/api/frontend');
  assert.equal(observed.length, 1);
  assert.equal(observed[0].owner.username, 'reader_b');
  assert.equal(observed[0].owner.serviceBase, 'https://learning-b.invalid');
  assert.equal(observed[0].owner.revision, observed[0].revision);
  env.LearningHttp.configure('reader_b', 'https://learning-b.invalid/');
  assert.equal(observed.length, 1);
  env.LearningHttp.configure('', '');
  assert.equal(observed.length, 2);
  assert.equal(observed[1].owner, null);
  assert.ok(observed[1].revision > observed[0].revision);
});

test('a failed Preferences flush reports unsaved state and retries durability before HTTP', async () => {
  const env = environment();
  env.setFlushFailure(true);
  assert.equal(await env.api.queueReadingProgress(env.context, env.point()), 'failed');
  assert.equal(env.requests.length, 0);
  assert.equal(env.storage.get('nxReadingSyncStatus'), 'failed');
  assert.equal(env.disk.size, 0);
  env.setFlushFailure(false);
  assert.equal(await env.api.flushReadingProgress(env.context), true);
  assert.equal(env.requests.length, 1);
});

test('a failed Preferences put does not claim the snapshot is saved', async () => {
  const env = environment();
  env.setPutFailure(true);
  assert.equal(await env.api.queueReadingProgress(env.context, env.point()), 'failed');
  assert.equal(env.requests.length, 0);
  assert.equal(env.cache.size, 0);
  env.setPutFailure(false);
  assert.equal(await env.api.queueReadingProgress(env.context, env.point()), 'synced');
});

test('the first durable write completes before a reading request can start', async () => {
  const env = environment();
  const gate = deferred();
  env.setFlushGate(gate.promise);
  const pending = env.api.queueReadingProgress(env.context, env.point());
  await env.waitFlush(1);
  assert.equal(env.requests.length, 0);
  gate.resolve();
  assert.equal(await pending, 'synced');
});

test('synchronized feedback waits until the ACK is durable', async () => {
  const env = environment();
  const httpGate = deferred();
  const diskGate = deferred();
  env.setHandler(async () => { await httpGate.promise; return { status: 200, body: { success: true } }; });
  let resolved = false;
  const pending = env.api.queueReadingProgress(env.context, env.point()).then(result => { resolved = true; return result; });
  await env.waitRequest();
  env.setFlushGate(diskGate.promise);
  httpGate.resolve();
  await env.settle();
  assert.equal(resolved, false);
  assert.equal(env.bridge.latest(), null);
  diskGate.resolve();
  assert.equal(await pending, 'synced');
});

test('a corrupt outbox is quarantined durably without blocking a new valid visit', async () => {
  const env = environment();
  const owner = env.LearningHttp.captureIdentity();
  const key = 'nx_reading_outbox_' + owner.scope;
  env.cache.set(key, 'not-json');
  assert.equal(await env.api.queueReadingProgress(env.context, env.point()), 'synced');
  assert.equal(env.disk.get('nx_reading_outbox_invalid_' + owner.scope), 'not-json');
  assert.equal(env.requests.length, 1);
  assert.equal((await env.pending()).length, 0);
});

test('invalid local rows are isolated while valid sessions continue', async () => {
  const env = environment();
  const owner = env.LearningHttp.captureIdentity();
  env.cache.set('nx_reading_outbox_' + owner.scope, JSON.stringify([null, {}, env.point()]));
  assert.equal(await env.api.flushReadingProgress(env.context), true);
  assert.equal(env.requests.length, 1);
  assert.equal((await env.pending()).length, 0);
});

test('reading telemetry uses runtime identity and shared cumulative evidence without entering the outbox', async () => {
  const env = environment();
  const point = env.point();
  point.paragraph_index = 7;
  assert.equal(await env.api.postTelemetry(point, 'snapshot', { scroll: 0.5, focus: 'reader', selText: '甲😀' }), true);
  const request = env.requests[0];
  assert.equal(request.url, 'https://learning-a.invalid/api/telemetry/ingest');
  assert.deepEqual(request.body, {
    user_id: 'reader_a', events: [{ stream: 'reading', event: 'snapshot', uid: 'reader_a', bid: 'book', ci: 0, si: 7,
      scroll: 0.5, focus: 'reader', sel_text: '甲😀', extra: { session_key: 'visit', active_duration_ms: 10000, lecture_id: 'lecture' } }],
  });
  env.setHandler(async () => ({ status: 503, body: { success: false } }));
  assert.equal(await env.api.postTelemetry(point, 'focus_out'), false);
  assert.equal(env.cache.size, 0);
});

test('textbook completion, contextual answers, and flow completion use distinct backend contracts', async () => {
  const env = environment();
  env.setHandler(async request => ({ status: 200, body: request.url.endsWith('/ask-in-context')
    ? { success: true, data: { answer: '**答案**' } }
    : { success: true, already_completed: true } }));
  const point = env.point();
  assert.deepEqual(plain(await env.api.postChapterComplete(point)), { ok: true, message: '', alreadyCompleted: true });
  assert.equal(env.requests[0].url, 'https://learning-a.invalid/api/frontend/learning/chapter-complete');
  assert.equal(env.bridge.latest().type, 'chapter_completed');
  const firstTick = env.bridge.latest().tick;
  assert.deepEqual(plain(await env.api.askInContext(point, ' 为什么？ ', '这一页的正文')), { ok: true, message: '', answer: '**答案**' });
  assert.equal(env.requests[1].body.context_text, '这一页的正文');
  assert.equal(env.requests[1].body.source, 'app');
  assert.equal(env.requests[1].body.question, '为什么？');
  assert.deepEqual(plain(await env.api.postReadingDone('flow-1', point.owner)), { ok: true, message: '' });
  assert.equal(env.requests[2].url, 'https://learning-a.invalid/api/agent/v1/flow/event');
  assert.deepEqual(env.requests[2].body, { flow_id: 'flow-1', event: 'reading_done' });
  assert.equal(env.bridge.latest().flowId, 'flow-1');
  assert.equal(env.bridge.latest().type, 'flow_reading_done');
  assert.ok(env.bridge.latest().tick > firstTick);
  assert.ok(env.requests.every(request => request.body.owner === undefined && request.body.day_key === undefined));
});

test('stale contextual responses and reading actions cannot update a new account', async () => {
  const env = environment();
  const gate = deferred();
  env.setHandler(async () => { await gate.promise; return { status: 200, body: { success: true, data: { answer: 'old account' } } }; });
  const point = env.point();
  const answer = env.api.askInContext(point, 'question', 'page');
  await env.waitRequest();
  env.LearningHttp.configure('reader_b', point.owner.serviceBase);
  gate.resolve();
  assert.equal((await answer).ok, false);
  assert.equal((await env.api.postChapterComplete(point)).ok, false);
  assert.equal((await env.api.postReadingDone('flow', point.owner)).ok, false);
  assert.equal(await env.api.postTelemetry(point, 'session_complete'), false);
  assert.equal(env.requests.length, 1);
  assert.equal(env.bridge.latest(), null);
});

test('LearningHttp exposes exact status, accepts 2xx, and refuses unconfigured fallback URLs', async () => {
  const env = environment();
  env.setHandler(async () => ({ status: 201, body: { success: true } }));
  const response = await env.LearningHttp.postJson('/created', {});
  assert.equal(response.ok, true);
  assert.equal(response.status, 201);
  env.setHandler(async () => ({ status: 409, body: { success: false, error: 'visit collision' } }));
  const conflict = await env.LearningHttp.postJson('/progress', {});
  assert.equal(conflict.ok, false);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.message, 'visit collision');
  env.LearningHttp.configure('', '');
  assert.equal((await env.LearningHttp.postJson('/progress', {})).status, 0);
  assert.equal(env.requests.length, 2);
  assert.equal((await env.api.queueReadingProgress(env.context, env.point())).toString(), 'failed');
});
