/* Run with `node --test tools/test_reading_progress.cjs`.
 * Executes the production ArkTS service and Reader lifecycle methods with a
 * deterministic clock/network. ArkUI rendering is deliberately outside this seam.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const tsPath = process.env.NEXORA_TYPESCRIPT_PATH ||
  'C:/Program Files/Huawei/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript/lib/typescript.js';
const ts = require(tsPath);
const sourceRoot = path.resolve(__dirname, '../entry/src/main/ets');

function withoutUiMethods(source) {
  const names = /\n  (?:@Builder\s+[^\n]+|build\(\))\s*\{/;
  let match;
  while ((match = names.exec(source))) {
    const brace = source.indexOf('{', match.index);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source.slice(brace));
    let depth = 0;
    let end = brace;
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.OpenBraceToken) depth++;
      if (token === ts.SyntaxKind.CloseBraceToken && --depth === 0) {
        end = brace + scanner.getTextPos();
        break;
      }
    }
    if (end === brace) throw new Error('Cannot isolate ArkUI builder');
    source = source.slice(0, match.index) + source.slice(end);
  }
  return source;
}

function environment(realCache = false) {
  let now = 100000;
  let username = 'reader_a';
  let baseUrl = 'http://fixture.invalid';
  let connected = true;
  let requestGate = null;
  let httpHandler = null;
  let identityGate = null;
  let flushGate = null;
  let flushGateStart = 1;
  let flushCount = 0;
  const flushWaiters = new Map();
  let putFails = false;
  let flushFails = false;
  let nextTimer = 1;
  const timers = new Map();
  const cache = new Map();
  const storage = new Map();
  const requests = [];
  const httpClients = [];
  let notifyRequest;
  const requestStarted = new Promise(resolve => { notifyRequest = resolve; });
  const telemetry = [];
  const checkpoints = [];
  const flowEvents = [];
  let sharedCache = {
    init() {},
    get: key => cache.get(key) || '',
    put: (key, value) => cache.set(key, value),
    getRequired: key => cache.get(key) || '',
    putDurable: async (key, value) => { cache.set(key, value); },
    getNumber: (key, fallback) => cache.has(key) ? Number(cache.get(key)) : fallback,
    putNumber: (key, value) => cache.set(key, String(value)),
  };
  const preferences = { getPreferencesSync: () => ({
    getSync: (key, fallback) => cache.has(key) ? cache.get(key) : fallback,
    putSync(key, value) {
      if (putFails) throw new Error('fixture put failure');
      cache.set(key, value);
    },
    async flush() {
      flushCount++;
      if (flushWaiters.has(flushCount)) flushWaiters.get(flushCount)();
      if (flushGate && flushCount >= flushGateStart) await flushGate;
      if (flushFails) throw new Error('fixture flush failure');
    },
  }) };
  const Identity = {
    current: () => username,
    waitReady: async () => { if (identityGate) await identityGate; return username; },
    isAuthenticated: () => username.length > 0,
    baseUrl: () => baseUrl,
    authHeaders: () => ({ 'X-Nexora-Username': username }),
  };
  const NxEnv = { baseUrl: () => baseUrl };
  const http = {
    RequestMethod: { GET: 'GET', POST: 'POST' },
    HttpDataType: { STRING: 0 },
    createHttp: () => {
      const client = { destroyed: false, destroyCount: 0, abort: null };
      httpClients.push(client);
      return {
        async request(url, options) {
          const request = { url, body: JSON.parse(options.extraData || '{}'), headers: options.header, client };
          requests.push(request);
          notifyRequest();
          const interrupted = new Promise((_resolve, reject) => { client.abort = reject; });
          const response = (async () => {
            if (httpHandler) return httpHandler(request);
            if (requestGate) await requestGate;
            if (!connected) throw new Error('fixture offline');
            return { responseCode: 200, result: JSON.stringify({ success: true }) };
          })();
          try {
            return await Promise.race([response, interrupted]);
          } finally {
            client.abort = null;
          }
        },
        destroy() {
          client.destroyed = true;
          client.destroyCount++;
          if (client.abort) client.abort(new Error('fixture request destroyed'));
        },
      };
    },
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const sharedTts = { stop() {}, release() {} };
  const sharedLiveView = { startStudy() {}, stopStudy() {}, updateStudy() {} };
  const AppStorage = {
    get(key) { return key === 'nxUsername' ? username : (key === 'nxBaseUrl' ? baseUrl : storage.get(key)); },
    setOrCreate(key, value) { storage.set(key, value); },
  };
  const modules = new Map();
  function load(relative, readerMock = false) {
    const key = relative + (readerMock ? ':reader' : '');
    if (modules.has(key)) return modules.get(key);
    const filename = path.join(sourceRoot, relative + '.ets');
    let source = fs.readFileSync(filename, 'utf8');
    if (/\bstruct\b/.test(source)) {
      const name = source.match(/\bstruct (\w+)/)[1];
      source = withoutUiMethods(source) + '\nexports.' + name + ' = ' + name + ';';
      source = source.replace(/\bstruct /, 'class ')
        .replace(/@(?:Entry|Component|State|Reusable|Prop)\b/g, '')
        .replace(/@(?:StorageProp|StorageLink|Watch)\([^)]*\)/g, '');
    }
    const result = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
      fileName: filename,
    });
    const exported = {};
    const sandbox = {
      exports: exported,
      console,
      Date: Clock,
      AppStorage,
      SwiperController: class {},
      ListScroller: class {},
      Scroller: class { scrollEdge() {} isAtEnd() { return true; } currentOffset() { return { xOffset: 0, yOffset: 0 }; } },
      setTimeout(callback, ms) { const id = nextTimer++; timers.set(id, { callback, ms, once: true }); return id; },
      setInterval(callback, ms) { const id = nextTimer++; timers.set(id, { callback, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
      clearInterval(id) { timers.delete(id); },
      require(specifier) {
        if (specifier.endsWith('/cache/CacheStore') || specifier === './cache/CacheStore') return { sharedCache };
        if (specifier.endsWith('/Identity') || specifier === './Identity') return { Identity };
        if (specifier.endsWith('/Env')) return { NxEnv };
        if (specifier.endsWith('/ReadingState')) return load('services/ReadingState');
        if (specifier.endsWith('/SoftGlowState')) return load('services/SoftGlowState');
        if (specifier.endsWith('/ReplyCancellation')) return load('services/ReplyCancellation');
        if (specifier.endsWith('/AmbientTokens')) return load('theme/AmbientTokens');
        if (specifier.endsWith('TimelineRows')) return load('components/entry/TimelineRows');
        if (specifier.endsWith('/ReaderApi')) return readerMock ? { ReaderApi: ReaderTransport } : load('services/ReaderApi');
        if (specifier.endsWith('/ReportApi')) return { ReportApi: class {} };
        if (specifier.endsWith('/AgentApi')) return { AgentApi: class {
          async postFlowEvent(...args) { flowEvents.push(args); }
        } };
        if (specifier.endsWith('/tts')) return { sharedTts };
        if (specifier.endsWith('/liveview')) return { sharedLiveView };
        if (specifier === '@kit.NetworkKit') return { http };
        if (specifier === '@kit.ArkData') return { preferences };
        if (specifier === '@kit.ArkTS') return { url: { URL: { parseURL: value => new URL(value) } } };
        if (specifier === '@kit.ArkUI') return {
          router: { getParams: () => ({}) },
          MeasureText: { measureTextSize: ({ textContent }) => ({ height: textContent.length * 2 }) },
        };
        return {};
      },
    };
    vm.runInNewContext(result.outputText, sandbox, { filename });
    modules.set(key, exported);
    return exported;
  }
  function chapter(index) {
    const start = index * 1000;
    return {
      success: true, coordinate_space: 'plain', chapter_index: index,
      chapter_title: 'Chapter ' + index, chapter_start: start, chapter_end: start + 1000,
      chapter_range: start + ':1000', chapter_count: 3,
      paragraphs: [{ index: 0, start, end: start + 1000, text: 'a'.repeat(1000), kind: 'text', heading_level: 0 }],
    };
  }
  class ReaderTransport {
    async getChapter(_lecture, _book, index) {
      if (!connected) throw new Error('fixture offline');
      return chapter(index);
    }
    async getIndex() { return { success: true, chapters: [] }; }
    async postTelemetry(events) { telemetry.push(...JSON.parse(JSON.stringify(events))); return connected; }
    queueReadingProgress(point) { checkpoints.push(JSON.parse(JSON.stringify(point))); return Promise.resolve(connected ? 'synced' : 'pending'); }
    async flushReadingProgress() { return connected; }
    async postChapterComplete() { if (!connected) throw new Error('fixture offline'); return true; }
  }
  function reader(realPagination = false) {
    const { Reader } = load('pages/Reader', true);
    const instance = new Reader();
    instance.getUIContext = () => ({ getHostContext: () => undefined, getPromptAction: () => ({ showToast() {} }) });
    instance.lectureId = 'lecture';
    instance.bookId = 'book';
    instance.bookTitle = 'Book';
    instance.loadMarks = () => {};
    if (!realPagination) instance.paginate = function () {
      this.pages = [0, 1, 2, 3].map(i => ({
        firstPara: i,
        blocks: [{ paraIndex: i, paraOffset: 0, text: 'a'.repeat(250),
          readStart: this.chapterIndex * 1000 + i * 250, readEnd: this.chapterIndex * 1000 + (i + 1) * 250 }],
      }));
      this.pageIndex = 0;
      if (this.onReaderPageChange) this.onReaderPageChange(0);
    };
    return instance;
  }
  function pageChange(instance, index) {
    const source = fs.readFileSync(path.join(sourceRoot, 'pages/Reader.ets'), 'utf8');
    const callback = source.match(/\.onChange\(\(index: number\) => \{([\s\S]*?)\n        \}\)/);
    assert.ok(callback, 'production Swiper page callback exists');
    const code = ts.transpileModule('(function(index: number) {' + callback[1] + '\n})', {
      compilerOptions: { target: ts.ScriptTarget.ES2021 },
    }).outputText;
    vm.runInNewContext(code).call(instance, index);
  }
  async function tick(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (!timers.has(id)) continue;
      if (timer.once) timers.delete(id);
      timer.callback();
    }
    await settle();
  }
  async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
  if (realCache) sharedCache = load('services/cache/CacheStore').sharedCache;
  return {
    reader, load, tick, pageChange, settle, requestStarted, requests, httpClients, telemetry, checkpoints, flowEvents, cache, storage,
    setConnected(value) { connected = value; },
    setUsername(value) { username = value; },
    setBaseUrl(value) { baseUrl = value; },
    setGate(value) { requestGate = value; },
    setHttpHandler(value) { httpHandler = value; },
    setIdentityGate(value) { identityGate = value; },
    setNow(value) { now = value; },
    initCache() { sharedCache.init({}); },
    setFlushGate(value, start = 1) { flushGate = value; flushGateStart = start; },
    waitForFlush(count) {
      return flushCount >= count ? Promise.resolve() : new Promise(resolve => { flushWaiters.set(count, resolve); });
    },
    setPutFailure(value) { putFails = value; },
    setFlushFailure(value) { flushFails = value; },
    elapse(ms) { now += ms; },
  };
}

test('partial reading emits progress before leaving or declaring the chapter complete', async () => {
  const env = environment();
  const reader = env.reader();
  if (reader.onPageShow) reader.onPageShow();
  await reader.load();
  await env.tick(10000);
  const point = env.checkpoints.at(-1);
  assert.ok(point, '10 seconds of visible reading must produce a checkpoint');
  assert.equal(point.active_duration_ms, 10000);
  assert.equal(point.started_at_ms, 100000);
  assert.equal(point.observed_at_ms, 110000);
  assert.deepEqual(point.read_ranges, [[0, 250]]);
});

test('chapter changes settle the old chapter; background time is not reading time', async () => {
  const env = environment();
  const reader = env.reader();
  if (reader.onPageShow) reader.onPageShow();
  await reader.load();
  env.elapse(6000);
  await reader.loadChapter(1);
  const first = env.checkpoints.find(point => point.chapter_index === 0);
  assert.ok(first, 'old chapter must be settled before replacing its state');
  assert.equal(first.active_duration_ms, 6000);
  env.elapse(3000);
  assert.equal(typeof reader.onPageHide, 'function');
  reader.onPageHide();
  await env.tick(1800000);
  reader.onPageShow();
  await env.tick(10000);
  const second = env.checkpoints.at(-1);
  assert.equal(second.chapter_index, 1);
  assert.equal(second.active_duration_ms, 13000);
  assert.notEqual(first.session_id, second.session_id);
});

test('page swipes keep only dwell-qualified ranges and do not count skipped pages', async () => {
  const env = environment();
  const reader = env.reader();
  if (reader.onPageShow) reader.onPageShow();
  await reader.load();
  env.elapse(3000);
  env.pageChange(reader, 2);
  env.elapse(500);
  env.pageChange(reader, 3);
  await env.tick(10000);
  assert.deepEqual(env.checkpoints.at(-1)?.read_ranges, [[0, 250], [750, 1000]]);
});

test('leaving an unfinished reading flow never reports reading_done', async () => {
  const env = environment();
  const reader = env.reader();
  reader.flowId = 'flow';
  if (reader.onPageShow) reader.onPageShow();
  await reader.load();
  env.elapse(1000);
  reader.aboutToDisappear();
  await env.settle();
  assert.equal(env.flowEvents.length, 0);
});

test('a failed chapter completion does not silently advance to another chapter', async () => {
  const env = environment();
  const reader = env.reader();
  await reader.load();
  env.setConnected(false);
  let advanced = false;
  reader.jumpChapter = () => { advanced = true; };
  await reader.finishChapterAndAdvance();
  assert.equal(advanced, false);
});

test('reading position is isolated between accounts', () => {
  const env = environment();
  const state = env.load('services/ReadingState');
  const point = new state.ReadingPosition();
  point.lectureId = 'lecture';
  point.bookId = 'book';
  state.nxSavePosition(point);
  env.setUsername('reader_b');
  assert.equal(state.nxLastBook(), null);
  assert.equal(state.nxReadPosition('lecture', 'book'), null);
});

function checkpoint(state, sequence = 1) {
  const point = new state.ReadingCheckpoint();
  point.lecture_id = 'lecture';
  point.book_id = 'book';
  point.chapter_name = 'Chapter 0';
  point.chapter_range = '0:1000';
  point.session_id = 'test-session';
  point.sequence = sequence;
  point.active_duration_ms = sequence * 10000;
  point.read_ranges = [[0, sequence * 100]];
  return point;
}

test('failed requests persist, coalesce, and retry only under their original account', async () => {
  const env = environment();
  const state = env.load('services/ReadingState');
  const { ReaderApi } = env.load('services/ReaderApi');
  const api = new ReaderApi();
  const originalScope = state.nxReadingScope();
  env.setConnected(false);
  assert.equal(await api.queueReadingProgress(checkpoint(state)), 'pending');
  assert.equal(await api.queueReadingProgress(checkpoint(state, 2)), 'pending');
  assert.equal(state.nxPendingReading(originalScope).length, 1);
  env.setUsername('reader_b');
  env.setConnected(true);
  const before = env.requests.length;
  assert.equal(await new ReaderApi().flushReadingProgress(), true);
  assert.equal(env.requests.length, before, 'another account must not submit the old account\'s outbox');
  env.setUsername('reader_a');
  assert.equal(await new ReaderApi().flushReadingProgress(), true);
  assert.equal(env.requests.at(-1).body.sequence, 2);
  assert.equal(env.requests.at(-1).body.active_duration_ms, 20000);
  assert.equal(env.requests.at(-1).headers['X-Nexora-Username'], 'reader_a');
  assert.equal(state.nxPendingReading(originalScope).length, 0);
  assert.ok(env.storage.get('nxStudyTick'), 'refresh is signalled after an acknowledged write');
});

test('an older in-flight ACK never removes newer reading and only one drain runs', async () => {
  const env = environment();
  const state = env.load('services/ReadingState');
  const { ReaderApi } = env.load('services/ReaderApi');
  const api = new ReaderApi();
  let release;
  env.setGate(new Promise(resolve => { release = resolve; }));
  const first = api.queueReadingProgress(checkpoint(state));
  await env.settle();
  assert.equal(env.requests.length, 1);
  const second = new ReaderApi().queueReadingProgress(checkpoint(state, 2));
  await env.settle();
  assert.equal(env.requests.length, 1, 'concurrent callers share the same drain');
  release();
  await Promise.all([first, second]);
  assert.deepEqual(env.requests.map(request => request.body.sequence), [1, 2]);
  assert.equal(state.nxPendingReading(state.nxReadingScope()).length, 0);
});

test('pagination maps emoji and trimmed whitespace to canonical codepoint ranges and restores the exact block', () => {
  const env = environment();
  const reader = env.reader(true);
  reader.areaWidth = 300;
  reader.areaHeight = 100;
  reader.measureHeight = text => Array.from(text).length * 10;
  reader.paragraphs = [{ index: 0, start: 100, end: 111, text: ' \t甲😀乙  丙😀丁\n', kind: 'text', heading_level: 0 }];
  reader.paginate();
  assert.deepEqual(Array.from(reader.pages, page => [page.blocks[0].readStart, page.blocks[0].readEnd]), [[102, 105], [107, 110]]);
  reader.pendingPara = 0;
  reader.pendingParaOffset = 6;
  reader.paginate();
  assert.equal(reader.pageIndex, 1);
  assert.equal(env.load('services/ReadingState').nxCodePointLength('甲😀乙'), 3);
});

test('a failed chapter fetch resumes measurement of the chapter still visible', async () => {
  const env = environment();
  const reader = env.reader();
  reader.onPageShow();
  await reader.load();
  env.elapse(3000);
  env.setConnected(false);
  await assert.rejects(reader.loadChapter(1), /offline/);
  await env.tick(10000);
  assert.equal(env.checkpoints.at(-1).chapter_index, 0);
  assert.equal(env.checkpoints.at(-1).active_duration_ms, 10000);
});

test('overlay and background focus telemetry share cumulative foreground time', async () => {
  const env = environment();
  const reader = env.reader();
  reader.onPageShow();
  await reader.load();
  env.elapse(4000);
  reader.showAskSheet = true;
  reader.onReadingVisibilityChanged();
  await env.tick(60000);
  reader.showAskSheet = false;
  reader.onReadingVisibilityChanged();
  await env.tick(10000);
  reader.onPageHide();
  reader.aboutToDisappear();
  const last = env.checkpoints.at(-1);
  assert.equal(last.active_duration_ms, 14000);
  const readingEvents = env.telemetry.filter(event => event.extra?.session_key);
  assert.ok(readingEvents.length >= 4);
  assert.ok(readingEvents.every(event => event.extra.session_key === last.session_id));
  assert.ok(readingEvents.every(event => Number(event.extra.active_duration_ms) <= 14000));
});

test('mirror averages assessed concepts only; an assessed zero remains a real result', () => {
  const env = environment();
  const { InspectSheet } = env.load('components/InspectSheet');
  const sheet = new InspectSheet();
  sheet.mastery = [
    { concept: 'unknown', mastery: null, status: 'unknown' },
    { concept: 'read', mastery: null, status: 'unverified' },
    { concept: 'known', mastery: 0.8, status: 'mastered' },
    { concept: 'needs-review', mastery: 0, status: 'weak' },
  ];
  assert.equal(sheet.averageMastery(), 0.4);
  assert.equal(sheet.heatCells().length, 2);
  assert.equal(sheet.untouchedCount(), 2);
  sheet.mastery = [{ concept: 'read', mastery: null, status: 'unverified' }];
  assert.equal(sheet.averageMastery(), null);
});

test('mirror report navigation remains available when a course has no concept facets', async () => {
  const env = environment();
  const { InspectSheet } = env.load('components/InspectSheet');
  const sheet = new InspectSheet();
  sheet.api = { getCognitionOverview: async () => ({ data: {
    facets: [], mastery: [], courses: [{ lecture_id: 'course-without-graph', title: 'Course' }],
    activity: { reading_seconds: 120, conversation_count: 1, memory_count: 1 },
  } }) };
  await sheet.load();
  assert.equal(sheet.reportLectureId, 'course-without-graph');
});

test('a new account can converse without a course, and a successful exchange refreshes its model', async () => {
  const env = environment();
  const { DayView } = env.load('pages/Day');
  const day = new DayView();
  day.inputText = 'I prefer examples before formulas';
  day.isLearningIntent = () => false;
  day.questionTarget = async () => null;
  day.appendEntry = () => {};
  day.dropEntry = () => {};
  day.revealAnswer = async () => {};
  day.getUIContext = () => ({ getHostContext: () => undefined });
  let called = false;
  day.api = { postAskInContext: async (_text, target) => {
    called = true;
    assert.equal(target, null);
    return { data: { answer: 'I will start with examples.', source: 'conversation', memory_updated: true } };
  } };
  await day.send();
  assert.equal(called, true);
  assert.ok(env.storage.get('nxStudyTick'));
});

test('an old timeline response cannot overwrite more recent learning feedback', async () => {
  const env = environment();
  const { DayView } = env.load('pages/Day');
  const day = new DayView();
  day.rebuild = () => {};
  day.deriveStatus = () => {};
  day.scrollToLatest = () => {};
  day.handleProactiveEntries = () => {};
  day.getUIContext = () => ({ getHostContext: () => undefined });
  let release;
  let calls = 0;
  day.api = { getEvents: () => ++calls === 1 ? new Promise(resolve => { release = resolve; }) :
    Promise.resolve({ data: { entries: [{ id: 'fresh' }] } }) };
  const first = day.loadEvents();
  await day.loadEvents();
  release({ data: { entries: [{ id: 'stale' }] } });
  await first;
  assert.equal(day.entries[0].id, 'fresh');
});

test('reports select the last-read book instead of silently showing an unread first book', async () => {
  const env = environment();
  const state = env.load('services/ReadingState');
  const position = new state.ReadingPosition();
  position.lectureId = 'course';
  position.bookId = 'book-read';
  state.nxSavePosition(position);
  const { Report } = env.load('pages/Report');
  const report = new Report();
  report.lectureId = 'course';
  report.agentApi = { getContext: async () => ({ data: { lectures: [{
    id: 'course', title: 'Course', books: [{ id: 'book-unread' }, { id: 'book-read' }],
  }] } }) };
  await report.resolveTarget();
  assert.equal(report.bookId, 'book-read');
  report.summary = { reading_progress_percent: 0.02, reading_seconds: 12, progress_percent: 0 };
  assert.equal(report.readingLabel(), '<0.1%');
  assert.equal(report.durationLabel(), '12 秒');
});

test('review resumes the canonical chapter on a new device regardless of record order', async () => {
  const env = environment();
  const { TodayTask } = env.load('pages/TodayTask', true);
  const page = new TodayTask();
  const lecture = {
    id: 'course', title: 'Course', books: [{ id: 'book', title: 'Book' }],
    current_book_id: 'book', current_chapter_index: 1, current_chapter: 'Chapter 1',
  };
  const context = { lectures: [lecture], active_session: {}, recent_learning_records: [] };
  page.api = { getContext: async () => ({ data: context }) };
  page.chooseBook = choice => { page.chapterIndex = choice.chapterIndex; };
  const records = [
    { lecture_id: 'course', book_id: 'book', chapter_index: 0, chapter_name: 'Chapter 0', timestamp: 100 },
    { lecture_id: 'course', book_id: 'book', chapter_index: 1, chapter_name: 'Chapter 1', timestamp: 200 },
  ];
  for (const ordering of [records, [...records].reverse(), [{ ...records[0], timestamp: 300 }, records[1]]]) {
    context.recent_learning_records = ordering;
    await page.loadTarget();
    assert.equal(page.errorText, '');
    assert.equal(page.chapterIndex, 1);
    assert.equal(page.books[0].chapterTitle, 'Chapter 1');
  }
  lecture.current_chapter_index = 0;
  lecture.current_chapter = 'Chapter 0';
  await page.loadTarget();
  assert.equal(page.chapterIndex, 0, 'canonical index zero must remain valid');
});

test('review history fallback uses the latest timestamp within the selected lecture and book', async () => {
  const env = environment();
  const { TodayTask } = env.load('pages/TodayTask', true);
  const page = new TodayTask();
  page.api = { getContext: async () => ({ data: {
    lectures: [{ id: 'course', title: 'Course', books: [{ id: 'book', title: 'Book' }] }],
    active_session: { lecture_id: 'other-course', book_id: 'book', chapter_index: 8 },
    recent_learning_records: [
      { lecture_id: 'other-course', book_id: 'book', chapter_index: 7, timestamp: 999 },
      { lecture_id: 'course', book_id: 'book', chapter_index: 1, chapter_name: 'Chapter 1', timestamp: 100 },
      { lecture_id: 'course', book_id: 'book', chapter_index: 0, chapter_name: 'Chapter 0', timestamp: 300 },
      { lecture_id: 'course', book_id: 'book', chapter_index: 2, chapter_name: 'Chapter 2', timestamp: 200 },
    ],
  } }) };
  page.chooseBook = choice => { page.chapterIndex = choice.chapterIndex; };
  await page.loadTarget();
  assert.equal(page.errorText, '');
  assert.equal(page.chapterIndex, 0);
  assert.equal(page.books[0].chapterTitle, 'Chapter 0');
});

test('thirty minutes of browsing are recorded while chapter completion stays explicit', async () => {
  const env = environment();
  const reader = env.reader();
  reader.onPageShow();
  await reader.load();
  let declaredComplete = false;
  reader.readerApi.postChapterComplete = async () => { declaredComplete = true; return true; };
  for (let minute = 0; minute < 30; minute++) {
    await env.tick(30000);
    env.pageChange(reader, minute % 4);
    await env.tick(30000);
    if (minute === 9 || minute === 19) await reader.loadChapter((minute + 1) / 10);
  }
  reader.onPageHide();
  const bySession = new Map(env.checkpoints.map(point => [point.session_id, point]));
  assert.equal([...bySession.values()].reduce((sum, point) => sum + point.active_duration_ms, 0), 1800000);
  assert.equal(bySession.size, 3);
  assert.ok([...bySession.values()].every(point => point.read_ranges.length > 0));
  assert.equal(declaredComplete, false);
});

test('a pagination boundary never splits one Unicode codepoint into two reading ranges', () => {
  const env = environment();
  const reader = env.reader(true);
  reader.measureHeight = text => text.length;
  const chunks = reader.splitToFit('😀甲', 0, 1);
  assert.equal(chunks[0], '😀');
  assert.equal(chunks.join(''), '😀甲');
});

test('cross-midnight outbox keeps each day and ACK never discards a different day', async () => {
  const env = environment();
  const state = env.load('services/ReadingState');
  const scope = state.nxReadingScope();
  const previous = checkpoint(state, 1);
  const next = checkpoint(state, 2);
  previous.started_at_ms = new Date(2026, 8, 14, 23, 50).getTime();
  previous.observed_at_ms = new Date(2026, 8, 14, 23, 59, 50).getTime();
  next.started_at_ms = previous.started_at_ms;
  next.observed_at_ms = new Date(2026, 8, 15, 0, 0, 10).getTime();
  await state.nxQueueReading(scope, next);
  await state.nxQueueReading(scope, previous);
  assert.equal(state.nxPendingReading(scope).length, 2);
  const ordered = await state.nxDurablePendingReading(scope);
  assert.deepEqual(Array.from(ordered, point => point.sequence), [1, 2]);
  await state.nxAcknowledgeReading(scope, next);
  assert.equal(state.nxPendingReading(scope)[0].sequence, 1);
});

test('uninitialized or failing preferences never claim a reading checkpoint was saved', async () => {
  const env = environment(true);
  const state = env.load('services/ReadingState');
  const { ReaderApi } = env.load('services/ReaderApi');
  const api = new ReaderApi();
  assert.equal(await api.queueReadingProgress(checkpoint(state)), 'failed');
  assert.equal(env.requests.length, 0);
  env.initCache();
  env.setPutFailure(true);
  assert.equal(await api.queueReadingProgress(checkpoint(state)), 'failed');
  assert.equal(env.requests.length, 0);
  env.setPutFailure(false);
  assert.equal(await api.queueReadingProgress(checkpoint(state)), 'synced');
});

test('the durability barrier completes before any HTTP reading request', async () => {
  const env = environment(true);
  env.initCache();
  const state = env.load('services/ReadingState');
  const { ReaderApi } = env.load('services/ReaderApi');
  let release;
  env.setFlushGate(new Promise(resolve => { release = resolve; }));
  const pending = new ReaderApi().queueReadingProgress(checkpoint(state));
  await env.settle();
  try {
    assert.equal(env.requests.length, 0, 'HTTP must wait for Preferences.flush()');
  } finally {
    release();
    await pending;
  }
});

test('failed disk flush is visible and is retried durably before sending', async () => {
  const env = environment(true);
  env.initCache();
  const state = env.load('services/ReadingState');
  const { ReaderApi } = env.load('services/ReaderApi');
  const api = new ReaderApi();
  env.setFlushFailure(true);
  assert.equal(await api.queueReadingProgress(checkpoint(state)), 'failed');
  assert.equal(env.requests.length, 0);
  assert.equal(env.storage.get('nxReadingSyncStatus'), 'failed');
  env.setFlushFailure(false);
  assert.equal(await api.flushReadingProgress(), true);
  assert.equal(env.requests.length, 1);
});

test('a successful response is not declared synchronized until the ACK is durable', async () => {
  const env = environment(true);
  env.initCache();
  const state = env.load('services/ReadingState');
  const { ReaderApi } = env.load('services/ReaderApi');
  let releaseHttp;
  let releaseAck;
  let synchronized = false;
  env.setGate(new Promise(resolve => { releaseHttp = resolve; }));
  const pending = new ReaderApi().queueReadingProgress(checkpoint(state)).then(status => {
    synchronized = true;
    return status;
  });
  await env.requestStarted;
  assert.equal(env.requests.length, 1);
  env.setFlushGate(new Promise(resolve => { releaseAck = resolve; }));
  releaseHttp();
  await env.settle();
  try {
    assert.equal(synchronized, false);
  } finally {
    releaseAck();
  }
  assert.equal(await pending, 'synced');
});

test('the reader distinguishes unsaved reading from safely queued offline reading', async () => {
  const env = environment();
  const reader = env.reader();
  reader.onPageShow();
  await reader.load();
  reader.readerApi.queueReadingProgress = async () => 'failed';
  await env.tick(10000);
  assert.match(reader.readingFeedback, /还没能保存/);
  reader.readerApi.queueReadingProgress = async () => 'pending';
  await env.tick(10000);
  assert.match(reader.readingFeedback, /保存在设备上/);
});

for (const change of ['account', 'backend']) {
  test('a pending durable read cannot send old reading after the ' + change + ' changes', async () => {
    const env = environment(true);
    env.initCache();
    const state = env.load('services/ReadingState');
    const { ReaderApi } = env.load('services/ReaderApi');
    const originalScope = state.nxReadingScope();
    let release;
    env.setFlushGate(new Promise(resolve => { release = resolve; }), 2);
    const pending = new ReaderApi().queueReadingProgress(checkpoint(state));
    await env.waitForFlush(2);
    if (change === 'account') env.setUsername('reader_b');
    else env.setBaseUrl('http://other-fixture.invalid');
    release();
    await pending;
    assert.equal(env.requests.length, 0);
    assert.equal(state.nxPendingReading(originalScope).length, 1);
  });
}

module.exports = { environment };
