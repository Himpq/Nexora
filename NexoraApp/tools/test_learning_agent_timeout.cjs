// Node >= 22.13. Exercise the production HTTP stack with an in-memory native adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');

function load(name, bindings = {}, exportedName = name) {
    const source = fs.readFileSync(path.resolve(__dirname, '../entry/src/main/ets/common', name + '.ets'), 'utf8')
        .replace(/^import\s[\s\S]*?;\r?\n/gm, '').replace(/^export\s/gm, '');
    return new Function(...Object.keys(bindings), stripTypeScriptTypes(source, { mode: 'transform' }) +
        '\nreturn ' + exportedName + ';')(...Object.values(bindings));
}

function fixture() {
    let now = 0;
    const requests = [];
    const storage = new Map([['nxSessionReady', true]]);
    const AppStorage = { get: (key) => storage.get(key), setOrCreate: (key, value) => storage.set(key, value) };
    const hilog = { info() {}, warn() {}, error() {} };
    const native = {
        RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 0 },
        createHttp() {
            const request = {
                settled: false, destroyed: false,
                request(url, options, callback) {
                    this.url = url;
                    this.options = options;
                    this.deadline = now + options.readTimeout;
                    this.callback = callback;
                },
                finish(error, payload = { success: true, data: {} }, status = 200) {
                    assert.equal(this.settled, false, 'request already completed');
                    this.settled = true;
                    this.callback(error, { responseCode: status, result: JSON.stringify(payload), header: {} });
                },
                destroy() { this.destroyed = true; }
            };
            requests.push(request);
            return request;
        }
    };
    const Json = load('JsonUtil', {}, 'Json');
    const HttpUtil = load('HttpUtil', { http: native, Json, hilog });
    HttpUtil.setBackendUrl('http://main.example');
    HttpUtil.setSessionCookie('session=fixture');
    const LearningHttp = load('LearningHttp', { HttpUtil, Json, hilog, AppStorage });
    LearningHttp.configure('fixture_user', 'http://learning.example/api/frontend');
    const LearningAgentApi = load('LearningAgentApi', { LearningHttp, Json, AppStorage });
    return {
        requests, HttpUtil, LearningHttp, api: LearningAgentApi,
        advance(milliseconds) {
            now += milliseconds;
            for (const request of requests) {
                if (!request.settled && !request.destroyed && request.deadline <= now) {
                    request.finish({ code: 2300028, message: 'Operation timed out' });
                }
            }
        }
    };
}

test('Agent answers can complete after the ordinary 15 second read deadline', async () => {
    const f = fixture();
    const pending = f.api.ask('synthetic input', null).then(
        (value) => ({ value }), (error) => ({ error }));
    const request = f.requests[0];
    f.advance(20000);
    assert.equal(request.settled, false, 'generation was stopped by the ordinary request deadline');
    request.finish(null, { success: true, data: { result: 'generated fixture' } });
    assert.deepEqual((await pending).value, { result: 'generated fixture' });
    assert.equal(request.destroyed, true);
    assert.equal(request.options.connectTimeout, 10000);
});

test('Agent uses the authenticated main proxy and transmits a stable message ID plus explicit context', async () => {
    const f = fixture();
    const pending = f.api.ask('Explain this', null, 'message-123', 'Picture text', 'My own note');
    const request = f.requests[0];
    assert.equal(request.url, 'http://main.example/api/learning/agent/ask-in-context');
    assert.equal(request.options.header.Cookie, 'session=fixture');
    const body = JSON.parse(request.options.extraData);
    assert.equal(body.client_message_id, 'message-123');
    assert.equal(body.photo_text, 'Picture text');
    assert.equal(body.notes_context, 'My own note');
    assert.equal(request.options.header['X-API-Key'], undefined);
    request.finish(null);
    await pending;
});

test('ordinary HTTP, Learning content, and other Agent operations keep their existing deadline', async () => {
    const target = { lecture_id: 'lecture', book_id: 'book', chapter_index: 0, chapter_name: 'Chapter' };
    const cases = [
        (f) => f.HttpUtil.get('http://main.example/api/user/info'),
        (f) => f.HttpUtil.post('http://main.example/api/user/preferences', {}),
        (f) => f.LearningHttp.postJson('/api/frontend/fixture', {}),
        (f) => f.api.getToday(),
        (f) => f.api.plan('synthetic input'),
        (f) => f.api.openSession(),
        (f) => f.api.reviewPlan(target),
        (f) => f.api.respondDecision('decision', 'accept'),
        (f) => f.api.acceptFlow(target),
        (f) => f.api.submitFlow('flow', []),
        (f) => f.api.submitReview('quiz', 'attempt', target, []),
        (f) => f.api.verdict({ id: 'facet', conceptId: 'concept', lectureId: 'lecture', bookId: 'book' }, 'agree')
    ];
    for (const call of cases) {
        const f = fixture();
        const pending = call(f).then((value) => ({ value }), (error) => ({ error }));
        const request = f.requests[0];
        f.advance(14999);
        assert.equal(request.settled, false);
        f.advance(1);
        assert.equal(request.settled, true);
        assert.equal(request.destroyed, true);
        await pending;
    }
});

test('the extended generation deadline is bounded and never leaks to the next request', async () => {
    const f = fixture();
    const pending = f.api.ask('synthetic input', null).then((value) => ({ value }), (error) => ({ error }));
    const generation = f.requests[0];
    f.advance(89999);
    assert.equal(generation.settled, false);
    f.advance(1);
    assert.equal(generation.settled, true);
    assert.match((await pending).error.message, /网络请求失败/);
    const ordinary = f.HttpUtil.post('http://main.example/api/user/preferences', {});
    const next = f.requests[1];
    f.advance(15000);
    assert.equal(next.settled, true);
    assert.equal((await ordinary).code, 0);
});
