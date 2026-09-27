// Run with Node >= 22.13: node tools/test_learning_reader.cjs
// Exercise the actual reader controller and ReadingSession without ArkUI rendering or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../entry/src/main/ets');

function load(source, exports, bindings = {}) {
    const plain = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '').replace(/^export\s/gm, '');
    return new Function(...Object.keys(bindings), stripTypeScriptTypes(plain) + '\nreturn {' + exports + '};')(
        ...Object.values(bindings));
}
function common(name) { return fs.readFileSync(path.join(root, 'common', name + '.ets'), 'utf8'); }
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function fixture() {
    let clock = 1700000000000;
    let nextTimer = 0;
    const timers = new Map();
    const owner = { username: 'reader', serviceBase: 'https://learning.example', scope: 'reader-scope', revision: 1 };
    let activeOwner = owner;
    const http = { captureIdentity: () => activeOwner, isCurrent: (identity) => identity !== null && identity === activeOwner };
    const events = [], points = [], completions = [], flows = [], asks = [], toasts = [];
    const hilog = { error() {}, warn() {}, info() {} };
    class TestDate extends Date { static now() { return clock; } }
    const { Json } = load(common('JsonUtil'), 'Json');
    const reading = load(common('LearningReading'), 'ReadingCheckpoint,ReadingSession,nxCodePointLength', {
        LearningHttp: http, PreferencesUtil: {}, Json, hilog, Date: TestDate,
    });
    const paginator = load(common('ReaderPaginator'), 'ReaderPaginator,ReaderBlockKind', {
        nxCodePointLength: reading.nxCodePointLength, hilog,
    });
    const api = {
        queueReadingProgress: async (context, point) => { points.push(point); return 'synced'; },
        saveReadingProgress: async (context, point) => { points.push(point); return { saved: true, status: 'synced' }; },
        postTelemetry: async (point, event, options) => { events.push({ point: { ...point }, event, options }); return true; },
        postChapterComplete: async (point) => { completions.push(point); return { ok: true, alreadyCompleted: false, message: '' }; },
        postReadingDone: async (id, identity) => { flows.push({ id, owner: identity }); return { ok: true, message: '' }; },
        askInContext: async (point, question, text) => { asks.push({ point, question, text }); return { ok: true, answer: '**answer**' }; },
    };
    const learningApi = { shared: { getBookChapter: async () => { throw new Error('Unexpected chapter request'); } } };
    const source = fs.readFileSync(path.join(root, 'components/learning/LearningReader.ets'), 'utf8')
        .split('    // ---------- 视图 ----------')[0]
        .replace(/@(?:Component|ObjectLink|Prop|State|StorageProp|Watch|Link)(?:\([^)]*\))?\s*/g, '')
        .replace('export struct LearningReader', 'export class LearningReader') + '\n}';
    const { LearningReader } = load(source, 'LearningReader', {
        ...reading, ...paginator, LearningApi: learningApi, LearningReadingApi: api, LearningHttp: http, hilog, Date: TestDate,
        NO_BOOK: {}, MeasureText: {}, Motion: { durationBase: 0 },
        Scroller: class {}, SwiperController: class { changeIndex() {} },
        readerParagraphGap: () => 1,
        promptAction: { showToast: ({ message }) => toasts.push(message) },
        setInterval: (callback) => { const id = nextTimer++; timers.set(id, callback); return id; },
        clearInterval: (id) => timers.delete(id), setTimeout: () => 0,
    });
    const reader = new LearningReader();
    reader.app = { saveReadPosition: async () => {}, readerFontSize: 1, readerLineHeight: () => 1 };
    Object.assign(reader, { lectureId: 'lecture', book: { id: 'book', title: 'Book' }, navLevel: 1, navDepth: 1,
        visible: true, appForeground: true, opening: false, initialized: true, readingContext: {}, readingOwner: owner,
        layoutWidth: 20, layoutHeight: 300 });
    reader.measure = (text) => Math.ceil(Array.from(text).length / 20);
    reader.preloadNext = () => {};
    reader.prependPrev = () => {};
    reader.chapters = [0, 1, 2].map((index) => ({ index, title: 'Chapter ' + index }));
    reader.contents.set(0, content(0));
    reader.contents.set(1, content(1));
    reader.order = [0, 1];
    reader.pages = [page(0, 0, 100, 110), page(0, 1, 110, 120), page(1, 0, 200, 210)];
    return { reader, api, learningApi, owner, events, points, completions, flows, asks, toasts, timers,
        advance: (ms) => { clock += ms; }, now: () => clock,
        switchIdentity: () => {
            activeOwner = { ...owner, username: 'another', scope: 'another-scope', revision: 2 };
            reader.onReadingIdentityChanged();
        },
    };
}
function content(chapterIndex) {
    const start = 100 + chapterIndex * 100;
    return { chapterIndex, chapterTitle: 'Chapter ' + chapterIndex, chapterRange: start + ':50', coordinateSpace: 'plain',
        chapterStart: start, chapterCount: 3, bookTotalChars: 400,
        paragraphs: [{ index: chapterIndex * 10, kind: 'text', text: 'A'.repeat(50), imageId: '', start, end: start + 50 }] };
}
function page(chapterIndex, pageIndex, start, end) {
    return { key: chapterIndex + '_' + pageIndex, chapterIndex, chapterTitle: 'Chapter ' + chapterIndex,
        pageInChapter: pageIndex + 1, pageCountInChapter: 2, bookProgress: 0,
        page: { sectionTitle: 'Section', blocks: [{ kind: 'text', text: 'visible page', paragraphIndex: chapterIndex * 10 + pageIndex,
            readStart: start, readEnd: end, height: 20, gap: 0 }] } };
}

test('foreground and each reader overlay gate active time and the continuous two-second dwell', () => {
    const f = fixture(), r = f.reader;
    r.enterCurrentPage();
    f.advance(1000);
    assert.deepEqual(r.checkpointReading().read_ranges, []);
    for (const field of ['tocOpen', 'settingsOpen', 'askOpen']) {
        r[field] = true; r.onReadingVisibilityChanged();
        assert.equal(f.timers.size, 0);
        f.advance(10000);
        r[field] = false; r.onReadingVisibilityChanged();
    }
    r.appForeground = false; r.onReadingVisibilityChanged(); f.advance(10000);
    r.appForeground = true; r.onReadingVisibilityChanged();
    r.visible = false; r.onReadingVisibilityChanged(); f.advance(10000);
    r.visible = true; r.onReadingVisibilityChanged();
    r.navDepth = 2; r.onReadingVisibilityChanged(); f.advance(10000);
    r.navDepth = 1; r.onReadingVisibilityChanged();
    f.advance(1999);
    assert.deepEqual(r.checkpointReading().read_ranges, []);
    f.advance(1);
    const point = r.checkpointReading();
    assert.equal(point.active_duration_ms, 3000);
    assert.deepEqual(point.read_ranges, [[100, 110]]);
    assert.equal(f.timers.size, 1);
    assert.ok(f.events.some((event) => event.event === 'focus_out'));
});

test('page turns snapshot the old page; chapter boundaries create separate visits without completing chapters', () => {
    const f = fixture(), r = f.reader;
    r.enterCurrentPage(); const firstSession = r.sessionPoint.session_id;
    f.advance(2000); r.onPageChanged(1);
    f.advance(1500); r.onPageChanged(2);
    const closed = f.events.find((event) => event.event === 'session_complete').point;
    assert.equal(closed.session_id, firstSession);
    assert.equal(closed.chapter_index, 0);
    assert.equal(closed.page_index, 1);
    assert.equal(closed.paragraph_index, 1);
    assert.equal(closed.active_duration_ms, 3500);
    assert.deepEqual(closed.read_ranges, [[100, 110]]);
    assert.notEqual(r.sessionPoint.session_id, firstSession);
    f.advance(2000);
    const next = r.checkpointReading();
    assert.equal(next.chapter_index, 1);
    assert.deepEqual(next.read_ranges, [[200, 210]]);
    assert.equal(next.active_duration_ms, 2000);
    assert.equal(f.completions.length, 0);
});

test('preload reindexing preserves dwell and range anchors locate a later fragment of one paragraph', () => {
    const f = fixture(), r = f.reader;
    r.enterCurrentPage(); f.advance(1500);
    r.pages = [page(2, 0, 300, 310), ...r.pages]; r.currentIndex = 1; r.enterCurrentPage();
    f.advance(600);
    assert.deepEqual(r.checkpointReading().read_ranges, [[100, 110]]);
    const pages = [page(0, 0, 100, 110), page(0, 1, 110, 120), page(0, 2, 120, 130)];
    for (const entry of pages) entry.page.blocks[0].paragraphIndex = 0;
    assert.equal(r.anchorIndex(pages, { chapterIndex: 0, paragraphIndex: 0, readStart: 120, completion: false }), 2);
    pages.push({ ...pages[2], page: { blocks: [], sectionTitle: '' } });
    assert.equal(r.anchorIndex(pages, { chapterIndex: 0, paragraphIndex: 0, readStart: -1, completion: true }), 3);
});

test('overlapping whole paragraphs are intersected with the exact plain chapter range', () => {
    const f = fixture(), r = f.reader;
    r.contents.get(0).chapterRange = '105:10';
    r.pages[0].page.blocks.push(r.pages[1].page.blocks[0]);
    r.enterCurrentPage(); f.advance(2000);
    assert.deepEqual(r.checkpointReading().read_ranges, [[105, 115]]);
    r.finishReadingSession(); r.contents.get(0).coordinateSpace = 'raw'; r.enterCurrentPage();
    assert.equal(r.readingSession, null);
});

test('late chapter responses cannot replace the current chapter or revive a disposed reader', async () => {
    const f = fixture(), r = f.reader, first = deferred(), second = deferred();
    f.learningApi.shared.getBookChapter = async (lecture, book, index) => index === 0 ? first.promise : second.promise;
    const a = r.openChapter(0), b = r.openChapter(1);
    second.resolve({ success: true, content: content(1), message: '' }); await b;
    first.resolve({ success: true, content: content(0), message: '' }); await a;
    assert.deepEqual([...r.contents.keys()], [1]);
    assert.equal(r.currentChapterIndex(), 1);
    assert.equal(r.sessionPoint.chapter_index, 1);
    const last = deferred(); f.learningApi.shared.getBookChapter = () => last.promise;
    const pending = r.openChapter(2); r.aboutToDisappear();
    last.resolve({ success: true, content: content(2), message: '' }); await pending;
    assert.equal(r.contents.size, 0);
    assert.equal(r.readingSession, null);
    assert.equal(f.timers.size, 0);
});

test('ask uses the visible page text and discards a response from the previous chapter', async () => {
    const f = fixture(), r = f.reader, answer = deferred();
    r.enterCurrentPage(); r.openAsk(); r.questionText = 'Explain this';
    let sent;
    f.api.askInContext = (point, question, text) => { sent = { point, question, text }; return answer.promise; };
    const pending = r.submitQuestion();
    assert.equal(sent.text, 'visible page');
    assert.equal(sent.point.chapter_index, 0);
    assert.equal(f.timers.size, 0);
    r.onPageChanged(2);
    answer.resolve({ ok: true, answer: 'old answer' }); await pending;
    assert.deepEqual(r.askTurns, []);
    assert.equal(r.askBusy, false);
    assert.ok(f.events.some((event) => event.event === 'ask'));
});

test('explicit completion acknowledged after exit still advances only the requested flow once', async () => {
    const f = fixture(), r = f.reader, completion = deferred();
    r.flowId = 'flow_1'; r.flowChapterIndex = 0; r.enterCurrentPage();
    f.api.postChapterComplete = (point) => { f.completions.push(point); return completion.promise; };
    f.advance(2200);
    const pending = r.completeChapter(0);
    assert.equal(f.points.at(-1).chapter_index, 0);
    await Promise.resolve();
    r.aboutToDisappear();
    assert.equal(f.flows.length, 0);
    completion.resolve({ ok: true, alreadyCompleted: true }); await pending;
    assert.deepEqual(f.flows, [{ id: 'flow_1', owner: f.owner }]);
    r.completeConfirmedFlow();
    assert.equal(f.flows.length, 1);
});

test('failed completion or completion of a different chapter does not advance the review flow', async () => {
    const f = fixture(), r = f.reader;
    r.flowId = 'flow_2'; r.flowChapterIndex = 1; r.enterCurrentPage();
    await r.completeChapter(0); r.aboutToDisappear();
    assert.equal(f.flows.length, 0);
    const g = fixture(); g.reader.flowId = 'flow_3'; g.reader.flowChapterIndex = 0;
    g.reader.enterCurrentPage(); g.api.postChapterComplete = async () => ({ ok: false, message: 'offline' });
    await g.reader.completeChapter(0); g.reader.aboutToDisappear();
    assert.equal(g.flows.length, 0);
    assert.equal(g.reader.completedChapters.length, 0);
});

test('heartbeat includes chapter-local scroll and disposal ends the last visible visit', () => {
    const f = fixture(), r = f.reader;
    r.enterCurrentPage(); f.advance(10000); [...f.timers.values()][0]();
    const beat = f.events.find((event) => event.event === 'snapshot');
    assert.equal(beat.options.scroll, 0.5);
    assert.equal(beat.point.active_duration_ms, 10000);
    r.aboutToDisappear(); f.advance(60000);
    assert.equal(f.timers.size, 0);
    assert.equal(f.events.filter((event) => event.event === 'session_complete').length, 1);
    assert.equal(f.points.at(-1).active_duration_ms, 10000);
});

test('completion cards never consume the space reserved for final-page text', () => {
    const { reader: r } = fixture();
    r.layoutHeight = 300;
    const full = [{ blocks: [{ height: 220, gap: 0, text: 'keep me' }], sectionTitle: 'Chapter' }];
    r.reserveCompletionCard(full, 'Chapter');
    assert.equal(full.length, 2);
    assert.equal(full[0].blocks[0].text, 'keep me');
    assert.deepEqual(full[1].blocks, []);
    const short = [{ blocks: [{ height: 100, gap: 0 }], sectionTitle: 'Chapter' }];
    r.reserveCompletionCard(short, 'Chapter');
    assert.equal(short.length, 1);
});

test('identity changes stop timing immediately and reject old chapter content', async () => {
    const f = fixture(), r = f.reader;
    r.enterCurrentPage(); f.advance(2000); f.switchIdentity(); f.advance(60000);
    assert.equal(r.readingSession, null);
    assert.equal(f.points.at(-1).active_duration_ms, 2000);
    assert.equal(f.points.at(-1).owner, f.owner);
    r.enterCurrentPage();
    assert.equal(r.readingSession, null);
    const g = fixture(), chapter = deferred();
    g.learningApi.shared.getBookChapter = () => chapter.promise;
    const pending = g.reader.openChapter(0);
    g.switchIdentity(); chapter.resolve({ success: true, content: content(0), message: '' }); await pending;
    assert.equal(g.reader.contents.size, 0);
    assert.equal(g.reader.readingSession, null);
});

test('completion waits for the reading checkpoint to be saved and never runs after a save failure', async () => {
    const f = fixture(), r = f.reader, saved = deferred();
    r.enterCurrentPage(); f.advance(2000);
    f.api.saveReadingProgress = () => saved.promise;
    const pending = r.completeChapter(0);
    assert.equal(f.completions.length, 0);
    saved.resolve({ saved: true, status: 'pending' }); await pending;
    assert.equal(f.completions.length, 1);
    const g = fixture(); g.reader.enterCurrentPage();
    g.api.saveReadingProgress = async () => ({ saved: false, status: 'failed' });
    await g.reader.completeChapter(0);
    assert.equal(g.completions.length, 0);
});

test('discarding an old broken outbox item does not block a successfully saved explicit completion', async () => {
    const f = fixture(); f.reader.enterCurrentPage();
    f.api.saveReadingProgress = async () => ({ saved: true, status: 'failed' });
    await f.reader.completeChapter(0);
    assert.equal(f.completions.length, 1);
});
