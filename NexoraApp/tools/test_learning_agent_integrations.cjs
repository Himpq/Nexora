const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../entry/src/main/ets');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise(setImmediate);
function load(relative, name, bindings = {}) {
    const source = fs.readFileSync(path.join(root, relative + '.ets'), 'utf8')
        .replace(/^import\s[\s\S]*?;\r?\n/gm, '').replace(/^export\s/gm, '');
    return new Function(...Object.keys(bindings), stripTypeScriptTypes(source) + '\nreturn ' + name)(...Object.values(bindings));
}

function notesFixture() {
    let owner = {}, fetcher, saver;
    const store = { activeNotebookId: 'book', notebooks: [{ id: 'book', name: 'Notebook', ts: 1 }],
        notes: [{ id: 'existing', content: 'Keep this note', notebookId: 'book', updatedAt: 5 }], updatedAt: 5 };
    const writes = [];
    fetcher = async () => ({ success: true, store: structuredClone(store) });
    saver = async (updated, base) => { writes.push({ updated, base }); Object.assign(store, updated); return { success: true, store }; };
    const Notes = load('common/LearningAgentNotes', 'LearningAgentNotes', {
        LearningHttp: { captureIdentity: () => owner, isCurrent: candidate => candidate === owner },
        ApiService: { fetchNotesStore: () => fetcher(), saveNotesStore: (updated, base) => saver(updated, base) },
    });
    return { Notes, store, writes, switchUser() { owner = {}; }, fetch(value) { fetcher = value; }, save(value) { saver = value; } };
}

test('saving an Agent record keeps the merge baseline and existing notes; repeated saves use the stable id', async () => {
    const f = notesFixture(), original = structuredClone(f.store);
    await f.Notes.save('answer-1', 'New answer', 'Explanation');
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0].base, original, 'the original cloud snapshot remains the merge baseline');
    assert.deepEqual(f.writes[0].updated.notes[0], original.notes[0]);
    assert.deepEqual(f.writes[0].updated.notebooks, original.notebooks);
    assert.equal(f.writes[0].updated.notes[1].id, 'learning_agent_answer-1');
    assert.equal(f.writes[0].updated.notes[1].notebookId, 'book');
    await f.Notes.save('answer-1', 'New answer', 'Explanation');
    assert.equal(f.writes.length, 1); assert.equal(f.store.notes.length, 2);
});

test('a fresh account receives a default notebook without dropping the new Agent note', async () => {
    const f = notesFixture(); Object.assign(f.store, { activeNotebookId: '', notebooks: [], notes: [] });
    await f.Notes.save('answer', 'Text', '');
    assert.equal(f.store.notes[0].notebookId, f.store.notebooks[0].id);
    assert.equal(f.store.notes[0].sourceTitle, 'Agent 学习记录');
});

test('switching account while fetching notes prevents either saving or returning private note context', async () => {
    for (const operation of ['save', 'context']) {
        const f = notesFixture(), wait = deferred(); f.fetch(() => wait.promise);
        const pending = operation === 'save' ? f.Notes.save('id', 'text', '') : f.Notes.context();
        f.switchUser(); wait.resolve({ success: true, store: f.store });
        await assert.rejects(pending, /账号已切换/); assert.equal(f.writes.length, 0);
    }
});

test('save failures remain retryable and a late save response cannot acknowledge a different account', async () => {
    const f = notesFixture(); f.save(async () => ({ success: false, message: 'offline' }));
    await assert.rejects(f.Notes.save('id', 'text', ''), /offline/);
    const wait = deferred(); f.save(() => wait.promise);
    const pending = f.Notes.save('id', 'text', ''); await turn(); f.switchUser();
    wait.resolve({ success: true }); await assert.rejects(pending, /账号已切换/);
});

test('note context sorts by recency without changing the stored order and bounds exported content', async () => {
    const f = notesFixture(); f.store.notes = [{ id: 'old', content: 'old', updatedAt: 1 },
        { id: 'new', content: 'new'.repeat(3000), updatedAt: 2 }];
    const context = await f.Notes.context(); assert.ok(context.startsWith('new'));
    assert.equal(context.length, 6000); assert.equal(f.store.notes[0].id, 'old');
});

const emptyTarget = { lecture_id: '', lecture_title: '', book_id: '', book_title: '', chapter_index: -1, chapter_name: '', chapter_range: '' };
const target = { ...emptyTarget, lecture_id: 'lecture', book_id: 'book', chapter_index: 2 };
function agentFixture() {
    const source = fs.readFileSync(path.join(root, 'components/agent/LearningAgent.ets'), 'utf8').split('\n    @Builder')[0] + '\n}';
    const plain = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '')
        .replace(/@(?:Component|ObjectLink|Prop|State|StorageProp|Watch|Link)(?:\([^)]*\))?\s*/g, '')
        .replace(/\bexport struct\b/g, 'class').replace(/^export\s/gm, '');
    let owner = {}; const calls = [], events = [];
    const api = { async getToday() { return { focus: target, today: {}, active_flow: null }; },
        async getEvents() { return events; }, async getFlow(id) { return { flow_id: id, status: 'running', step: 'opened', target }; },
        async ask(...args) { calls.push(args); } };
    const notes = { async save() {}, async context() { return ''; } };
    const assets = { async readPicture() { return ''; } };
    const bindings = { NO_AGENT_TARGET: emptyTarget, NO_BOOK: {}, ListScroller: class { scrollToIndex() {} },
        ScrollAlign: { START: 'start', CENTER: 'center', END: 'end' }, LearningAgentApi: api,
        LearningAgentNotes: notes, LearningAgentAssets: assets,
        LearningHttp: { captureIdentity: () => owner, isCurrent: candidate => candidate === owner },
        LearningAgentSystem: { async syncToday() {} }, LearningBridge: { latest: () => null },
        agentFailure: error => error.message, setTimeout: () => 0 };
    const { LearningAgent, AgentOutgoingMessage } = new Function(...Object.keys(bindings),
        stripTypeScriptTypes(plain, { mode: 'transform' }) + '\nreturn { LearningAgent, AgentOutgoingMessage };')(...Object.values(bindings));
    const agent = new LearningAgent(); agent.alive = true; agent.navDepth = 0;
    agent.getUIContext = () => ({ getHostContext: () => undefined });
    return { agent, api, notes, assets, calls, events, AgentOutgoingMessage, switchUser() { owner = {}; } };
}

test('current-flow data restores its own target and a server-side completion clears the resume card', async () => {
    const f = agentFixture(), a = f.agent;
    f.api.getToday = async () => ({ today: {}, active_flow: { flow_id: 'flow-current', target, step: 'quiz_ready' } });
    await a.refresh(); assert.equal(a.activeFlowId, 'flow-current'); assert.equal(a.activeFlowStep, 'quiz_ready');
    assert.deepEqual(a.activeFlowTarget, target);
    f.api.getToday = async () => ({ today: {}, active_flow: null }); await a.refresh(); assert.equal(a.activeFlowId, '');
});

test('an old today snapshot cannot erase a flow opened while that snapshot was in flight', async () => {
    const f = agentFixture(), wait = deferred(), a = f.agent;
    f.api.getToday = () => wait.promise; a.openReader = async () => {};
    const refreshing = a.refresh(); await a.openFlow('new-flow');
    wait.resolve({ today: {}, active_flow: null }); await refreshing;
    assert.equal(a.activeFlowId, 'new-flow');
});

test('canonical client IDs correlate repeated questions independently of message text and response order', () => {
    const f = agentFixture(), a = f.agent;
    const first = new f.AgentOutgoingMessage({ id: 'local-first', text: 'same', ts: 1, kind: 'user_msg' }, []);
    const second = new f.AgentOutgoingMessage({ id: 'local-second', text: 'same', ts: 1, kind: 'user_msg' }, []);
    first.started = second.started = true; first.pending = second.pending = false; first.errorText = 'failed';
    a.outgoingMessages = [first, second];
    a.entries = [{ id: 'server-second', kind: 'user_msg', client_message_id: 'local-second', text: 'normalized', ts: 2 },
        { id: 'other-client', kind: 'user_msg', client_message_id: 'foreign', text: 'same', ts: 2 }];
    a.rebuildTimeline(); assert.equal(first.remoteEntry, null); assert.equal(second.remoteEntry.id, 'server-second');
    assert.equal(a.timeline.filter(item => item.remoteId === 'server-second').length, 1);
});

test('save-to-notes is single-flight in the Agent controller and unlocks after failure', async () => {
    const f = agentFixture(), wait = deferred(), a = f.agent; let saves = 0;
    f.notes.save = () => { saves++; return wait.promise; };
    const row = { id: 'answer', text: 'Answer' }; a.entryExportText = () => 'Answer'; a.entryTitle = () => 'Title';
    const saving = a.saveNote(row); await a.saveNote(row); assert.equal(saves, 1);
    wait.resolve(); await saving; assert.equal(a.actionBusy, '');
    f.notes.save = async () => { throw new Error('offline'); }; await a.saveNote(row);
    assert.match(a.errorText, /offline/); assert.equal(a.actionBusy, '');
});

test('a photo selected for the previous identity never enters the new account draft', async () => {
    const f = agentFixture(), wait = deferred(); f.assets.readPicture = () => wait.promise;
    const picking = f.agent.pickPhoto(); f.switchUser(); wait.resolve('private OCR'); await picking;
    assert.equal(f.agent.photoText, ''); assert.equal(f.agent.pickingPhoto, false);
});

function assetsFixture({ releaseFailure = false } = {}) {
    const events = [], opens = [];
    const Assets = load('common/LearningAgentAssets', 'LearningAgentAssets', {
        canIUse: () => true,
        photoAccessHelper: { PhotoSelectOptions: class {}, PhotoViewMIMETypes: { IMAGE_TYPE: 'image' },
            PhotoViewPicker: class { async select() { return { photoUris: ['photo://one'] }; } } },
        picker: { DocumentSaveOptions: class {}, DocumentViewPicker: class { async save() { return ['doc://selected']; } } },
        fileIo: { OpenMode: { READ_ONLY: 1, READ_WRITE: 2, CREATE: 4, TRUNC: 8 },
            async open(uri, mode) { opens.push({ uri, mode }); return { fd: 7 }; }, async close() { events.push('file'); }, writeSync() {} },
        image: { PixelMapFormat: { RGBA_8888: 0 }, createImageSource: () => ({
            async getImageInfo() { return { size: { width: 4000, height: 2000 } }; },
            async createPixelMap(options) { events.push(options); return { async release() { events.push('pixels'); if (releaseFailure) throw new Error('release failed'); } }; },
            async release() { events.push('source'); },
        }) },
        textRecognition: { async recognizeText() { return { value: 'OCR text' }; } },
    });
    return { Assets, events, opens };
}

test('OCR bounds image dimensions and releases the pixel map, source and file', async () => {
    const f = assetsFixture(); assert.equal(await f.Assets.readPicture(), 'OCR text');
    assert.deepEqual(f.events[0].desiredSize, { width: 2048, height: 1024 });
    assert.deepEqual(f.events.slice(1), ['pixels', 'source', 'file']);
});

test('an OCR cleanup failure still closes the remaining native resources', async () => {
    const f = assetsFixture({ releaseFailure: true }); await f.Assets.readPicture().catch(() => {});
    assert.ok(f.events.includes('source')); assert.ok(f.events.includes('file'));
});

test('exporting over an existing selected document truncates old trailing content', async () => {
    const f = assetsFixture(); await f.Assets.exportText({}, 'shorter text');
    assert.ok(f.opens[0].mode & 8, 'a selected existing destination must be truncated before writing');
    assert.ok(f.events.includes('file'));
});
