// Node >= 22.13. Exercise the production memory controller and authenticated API contracts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');

const etsRoot = path.resolve(__dirname, '../entry/src/main/ets');
function load(relative, name, bindings = {}, controller = false) {
    let source = fs.readFileSync(path.join(etsRoot, relative), 'utf8');
    if (controller) source = source.split('\n    @Builder')[0] + '\n}';
    source = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '')
        .replace(/@(?:Component|ObjectLink|Prop|State|StorageProp|Watch|Link)(?:\([^)]*\))?\s*/g, '')
        .replace(/\bexport struct\b/g, 'class').replace(/^export\s/gm, '');
    return new Function(...Object.keys(bindings), stripTypeScriptTypes(source, { mode: 'transform' }) +
        '\nreturn ' + name + ';')(...Object.values(bindings));
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
function memory(id = 'mem_original', text = '我喜欢先看例子', kind = 'preference') {
    return { id, kind, text, updated_at: 1700000000, lecture_id: '', book_id: '' };
}
function fixture() {
    let owner = { username: 'user', serviceBase: 'https://learning.example', revision: 1 };
    const http = { configured: true, captureIdentity: () => owner,
        isCurrent: (candidate) => candidate !== null && candidate === owner && http.configured };
    const calls = { list: 0, save: [], forget: [] };
    const api = {
        async getMemories() { calls.list++; return { items: [memory()], generated_at: 1700000000 }; },
        async updateMemory(id, text) { calls.save.push({ id, text }); return { updated: true, item: memory('mem_replacement', text) }; },
        async forgetMemory(id) { calls.forget.push(id); return { updated: true }; }
    };
    const Controller = load('components/agent/LearningMemorySettings.ets', 'LearningMemorySettings', {
        LearningAgentApi: api, LearningHttp: http, agentFailure: (error) => error.message,
        LearningFormat: { day: () => '今天' }
    }, true);
    const controller = new Controller();
    controller.alive = true;
    controller.sessionReady = true;
    let changes = 0, backs = 0;
    controller.onChanged = () => { changes++; };
    controller.onBack = () => { backs++; };
    return { controller, api, http, calls,
        get changes() { return changes; }, get backs() { return backs; },
        switchIdentity() { owner = { ...owner, revision: owner.revision + 1 }; } };
}

test('the settings list accepts personal learning information without fetching cognition', async () => {
    const f = fixture(), c = f.controller;
    f.api.getMemories = async () => ({ items: [memory(), memory('reading', '读过 3 章', 'reading'),
        memory('chat', '🤣', 'conversation'), memory('empty', '  '), { kind: 'goal', text: '想学会数据库' },
        null, memory('goal', '想学会数据库', 'goal')], generated_at: 1700000000 });
    await c.load();
    assert.deepEqual(c.items.map((item) => item.id), ['mem_original', 'goal']);
    assert.equal(c.loading, false);
    assert.equal(c.errorText, '');
});

test('unavailable services clear personal data and do not start requests', async () => {
    const f = fixture(), c = f.controller;
    await c.load();
    c.beginEdit('mem_original');
    c.draftText = '尚未保存的个人信息';
    c.sessionReady = false;
    c.onIdentityChanged();
    assert.deepEqual(c.items, []);
    assert.equal(c.draftText, '');
    assert.equal(c.loading, false);
    assert.equal(c.canAct(), false);
    assert.equal(f.calls.list, 1);
    c.sessionReady = true;
    f.http.configured = false;
    await c.load();
    assert.equal(f.calls.list, 1);
    f.http.configured = true;
    await c.load();
    assert.equal(c.items.length, 1);
});

test('failed lists expose a retry and never turn malformed data into a normal empty state', async () => {
    const f = fixture(), c = f.controller;
    await c.load();
    f.api.getMemories = async () => { throw new Error('连接中断'); };
    await c.load();
    assert.match(c.errorText, /连接中断/);
    assert.deepEqual(c.items, [memory()], 'same-account records remain available after a failed refresh');
    assert.equal(c.loading, false);
    f.api.getMemories = async () => ({ generated_at: 1 });
    await c.load();
    assert.match(c.errorText, /数据不完整/);
    f.api.getMemories = async () => ({ items: [], generated_at: 1 });
    await c.load();
    assert.equal(c.errorText, '');
    assert.deepEqual(c.items, []);
});

test('hiding invalidates a pending list and a fresh view ignores the old response', async () => {
    const f = fixture(), c = f.controller, old = deferred();
    let requests = 0;
    f.api.getMemories = () => { requests++; return old.promise; };
    const pending = c.load();
    await c.load();
    assert.equal(requests, 1, 'double refresh must not create concurrent requests');
    c.visible = false;
    c.onVisibleChanged();
    assert.equal(c.loading, false);
    c.visible = true;
    f.api.getMemories = async () => ({ items: [memory('mem_fresh')], generated_at: 1 });
    await c.load();
    old.resolve({ items: [memory('mem_stale')], generated_at: 1 });
    await pending;
    assert.equal(c.items[0].id, 'mem_fresh');
    assert.equal(c.loading, false);
});

test('edits are single-flight, keep failed drafts, and use the replacement memory ID', async () => {
    const f = fixture(), c = f.controller, wait = deferred();
    await c.load();
    c.beginEdit('mem_original');
    c.draftText = '  我喜欢先看完整例子，再解释原理  ';
    f.api.updateMemory = (id, text) => { f.calls.save.push({ id, text }); return wait.promise; };
    const pending = c.saveEdit();
    await c.saveEdit();
    c.cancelEdit();
    assert.equal(c.editingId, 'mem_original', 'pending save must retain its editor');
    assert.deepEqual(f.calls.save, [{ id: 'mem_original', text: '我喜欢先看完整例子，再解释原理' }]);
    assert.equal(c.items[0].text, memory().text, 'saving must not optimistically overwrite the remembered text');
    wait.reject(new Error('连接中断'));
    await pending;
    assert.match(c.actionError, /连接中断/);
    assert.equal(c.draftText, '  我喜欢先看完整例子，再解释原理  ');
    assert.equal(c.editingId, 'mem_original');
    assert.equal(c.busyId, '');
    assert.equal(f.changes, 0);
    f.api.updateMemory = async (id, text) => ({ updated: true, item: memory('mem_replacement', text) });
    await c.saveEdit();
    assert.equal(c.items[0].id, 'mem_replacement');
    assert.equal(c.items[0].text, '我喜欢先看完整例子，再解释原理');
    assert.equal(c.editingId, '');
    assert.equal(c.draftText, '');
    assert.equal(f.changes, 1);
    c.beginEdit('mem_original');
    assert.equal(c.editingId, '', 'a stale item cannot be edited');
    c.requestForget('mem_replacement');
    await c.forget();
    assert.deepEqual(f.calls.forget, ['mem_replacement']);
    assert.deepEqual(c.items, []);
});

test('empty, unchanged and overlong drafts do not save or disappear on refresh', async () => {
    const f = fixture(), c = f.controller;
    await c.load();
    c.beginEdit('mem_original');
    for (const text of ['  ', memory().text, 'a'.repeat(2001)]) {
        c.draftText = text;
        await c.saveEdit();
        assert.equal(c.canSave(), false);
    }
    c.draftText = '保留这份草稿';
    await c.load();
    assert.equal(c.draftText, '保留这份草稿');
    assert.equal(f.calls.list, 1);
    assert.deepEqual(f.calls.save, []);
    c.requestForget('mem_original');
    assert.equal(c.forgetId, '', 'forget must not silently discard an open editor');
});

test('unsuccessful update acknowledgements preserve the edit until a valid response arrives', async () => {
    const f = fixture(), c = f.controller;
    await c.load();
    c.beginEdit('mem_original');
    c.draftText = '我希望按步骤讲解';
    for (const result of [{ updated: false }, { updated: true },
        { updated: true, item: memory('not_personal', '阅读了 5 分钟', 'reading') }]) {
        f.api.updateMemory = async () => result;
        await c.saveEdit();
        assert.equal(c.editingId, 'mem_original');
        assert.equal(c.draftText, '我希望按步骤讲解');
        assert.equal(c.items[0].id, 'mem_original');
        assert.match(c.actionError, /保存失败/);
    }
});

test('forget requires inline confirmation and leaves records intact on failure', async () => {
    const f = fixture(), c = f.controller, wait = deferred();
    await c.load();
    await c.forget();
    assert.deepEqual(f.calls.forget, []);
    c.requestForget('mem_original');
    c.cancelForget();
    await c.forget();
    assert.deepEqual(f.calls.forget, []);
    c.requestForget('mem_original');
    f.api.forgetMemory = (id) => { f.calls.forget.push(id); return wait.promise; };
    const pending = c.forget();
    await c.forget();
    assert.deepEqual(f.calls.forget, ['mem_original']);
    wait.resolve({ updated: false });
    await pending;
    assert.match(c.actionError, /忘记失败/);
    assert.equal(c.forgetId, 'mem_original');
    assert.equal(c.items.length, 1);
    assert.equal(f.changes, 0);
    f.api.forgetMemory = async () => ({ updated: true });
    await c.forget();
    assert.deepEqual(c.items, []);
    assert.equal(c.forgetId, '');
    assert.equal(f.changes, 1);
    assert.match(c.notice, /历史对话/);
});

test('changing identity clears drafts immediately and rejects old save and forget results', async () => {
    for (const operation of ['save', 'forget']) {
        const f = fixture(), c = f.controller, wait = deferred();
        await c.load();
        let pending;
        if (operation === 'save') {
            c.beginEdit('mem_original');
            c.draftText = '另一份学习安排';
            f.api.updateMemory = () => wait.promise;
            pending = c.saveEdit();
        } else {
            c.requestForget('mem_original');
            f.api.forgetMemory = () => wait.promise;
            pending = c.forget();
        }
        f.switchIdentity();
        c.sessionReady = false;
        c.onIdentityChanged();
        assert.deepEqual(c.items, []);
        assert.equal(c.draftText, '');
        assert.equal(c.busyId, '');
        c.sessionReady = true;
        f.api.getMemories = async () => ({ items: [memory('mem_other_account')], generated_at: 1 });
        await c.load();
        wait.resolve({ updated: true, item: memory('mem_stale_replacement') });
        await pending;
        assert.equal(c.items[0].id, 'mem_other_account');
        assert.equal(c.notice, '');
        assert.equal(c.actionError, '');
        assert.equal(f.changes, 0);
    }
});

test('leave and disappear ignore late mutations and never call the success callback', async () => {
    for (const leave of ['leave', 'aboutToDisappear']) {
        const f = fixture(), c = f.controller, wait = deferred();
        await c.load();
        c.beginEdit('mem_original');
        c.draftText = '先讲简单例子';
        f.api.updateMemory = () => wait.promise;
        const pending = c.saveEdit();
        c[leave]();
        c[leave]();
        wait.reject(new Error('迟到的错误'));
        await pending;
        assert.deepEqual(c.items, []);
        assert.equal(c.actionError, '');
        assert.equal(c.busyId, '');
        assert.equal(f.changes, 0);
        assert.equal(f.backs, leave === 'leave' ? 1 : 0);
    }
});

function apiFixture() {
    let owner = { username: 'user', revision: 1 };
    let sessionReady = true;
    const calls = [];
    const response = (data) => ({ ok: true, message: '', status: 200, payload: { success: true, data } });
    const http = { configured: true, captureIdentity: () => owner,
        isCurrent: (candidate) => candidate === owner,
        async getJson(route, identity) { calls.push({ method: 'GET', route, identity }); return response({ items: [memory()], generated_at: 1 }); },
        async postJson(route, payload, identity) { calls.push({ method: 'POST', route, payload, identity }); return response({ updated: true, item: memory('mem_new') }); }
    };
    const Json = load('common/JsonUtil.ets', 'Json');
    const api = load('common/LearningAgentApi.ets', 'LearningAgentApi', {
        LearningHttp: http, Json, AppStorage: { get: () => sessionReady }
    });
    return { api, http, calls, response, owner,
        signOut() { sessionReady = false; },
        switchIdentity() { owner = { username: 'user', revision: 2 }; } };
}

test('memory APIs use dedicated authenticated routes with the wire payloads', async () => {
    const f = apiFixture();
    assert.equal((await f.api.getMemories()).items[0].id, 'mem_original');
    assert.equal((await f.api.updateMemory('mem_original', '新偏好')).item.id, 'mem_new');
    assert.equal((await f.api.forgetMemory('mem_new')).updated, true);
    assert.deepEqual(f.calls, [
        { method: 'GET', route: '/api/agent/v1/memories', identity: f.owner },
        { method: 'POST', route: '/api/agent/v1/memories/update', payload: { memory_id: 'mem_original', text: '新偏好' }, identity: f.owner },
        { method: 'POST', route: '/api/agent/v1/memories/forget', payload: { memory_id: 'mem_new' }, identity: f.owner }
    ]);
});

test('memory APIs reject unready sessions and responses from previous identities', async () => {
    for (const name of ['getMemories', 'updateMemory', 'forgetMemory']) {
        const f = apiFixture(), wait = deferred();
        f.http.getJson = f.http.postJson = () => wait.promise;
        const pending = f.api[name]('mem_original', '新偏好');
        f.switchIdentity();
        wait.resolve(f.response({ items: [], updated: true, item: memory('mem_late') }));
        await assert.rejects(pending, /账号或学习服务已切换/);
        f.signOut();
        await assert.rejects(f.api[name]('mem_original', '新偏好'), /请先登录/);
    }
});

test('a missing memory-list endpoint explains the required service update without hiding other failures', async () => {
    const f = apiFixture();
    f.http.getJson = async () => ({ ok: false, status: 404, message: '请求失败(404)', payload: null });
    await assert.rejects(f.api.getMemories(), /当前学习服务尚未支持记忆管理，请更新服务后再试/);
    await assert.rejects(f.api.getToday(), /请求失败\(404\)/, 'other endpoints retain their original failure');
    f.http.postJson = f.http.getJson;
    for (const action of ['updateMemory', 'forgetMemory']) {
        await assert.rejects(f.api[action]('mem_stale', '新偏好'), /这条记忆已失效，请刷新列表后重试/);
    }
    f.http.getJson = async () => ({ ok: false, status: 503, message: '服务暂时不可用', payload: null });
    await assert.rejects(f.api.getMemories(), /服务暂时不可用/);
    const wait = deferred();
    f.http.getJson = () => wait.promise;
    const pending = f.api.getMemories();
    f.switchIdentity();
    wait.resolve({ ok: false, status: 404, message: '请求失败(404)', payload: null });
    await assert.rejects(pending, /账号或学习服务已切换/, 'identity checks take priority over the upgrade message');
});
