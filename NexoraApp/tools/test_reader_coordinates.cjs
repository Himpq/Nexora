// Run with Node >= 22.13: node tools/test_reader_coordinates.cjs
// Executes the production ETS logic after stripping types; no Harmony runtime or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');

const commonDir = path.resolve(__dirname, '../entry/src/main/ets/common');

function loadSource(source, names, bindings = {}) {
    const withoutImports = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '').replace(/^export\s/gm, '');
    const javascript = stripTypeScriptTypes(withoutImports);
    return new Function(...Object.keys(bindings), javascript + '\nreturn { ' + names.join(', ') + ' };')(
        ...Object.values(bindings));
}

function loadCommon(name, names, bindings = {}) {
    return loadSource(fs.readFileSync(path.join(commonDir, name + '.ets'), 'utf8'), names, bindings);
}

// Isolate the production helper so the paginator remains testable without Preferences / HTTP adapters.
const readingSource = fs.readFileSync(path.join(commonDir, 'LearningReading.ets'), 'utf8');
const codePointFunction = readingSource.match(/^export function nxCodePointLength\([\s\S]*?^}/m);
assert.ok(codePointFunction, 'LearningReading must export nxCodePointLength');
const { nxCodePointLength } = loadSource(codePointFunction[0], ['nxCodePointLength']);
const { Json } = loadCommon('JsonUtil', ['Json']);
const responses = [];
const requests = [];
const LearningHttp = {
    configured: true,
    configure() {},
    absolute(value) { return 'https://learning.example' + value; },
    isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); },
    async getJson(url) {
        requests.push(url);
        assert.ok(responses.length > 0, 'unexpected HTTP request: ' + url);
        return responses.shift();
    },
};
const { LearningApi } = loadCommon('LearningApi', ['LearningApi'], { Json, LearningHttp });
const { ReaderPaginator, ReaderBlockKind } = loadCommon('ReaderPaginator', ['ReaderPaginator', 'ReaderBlockKind'], {
    nxCodePointLength,
    hilog: { error() {} },
});

function enqueue(...payloads) {
    assert.equal(responses.length, 0, 'previous test did not consume its HTTP fixtures');
    requests.length = 0;
    responses.push(...payloads.map((payload) => ({ ok: true, payload, message: '' })));
}

function paragraph(text, start = 100, index = 0, kind = 'text', imageId = '') {
    return { text, start, end: start + Array.from(text).length, index, kind, imageId };
}

function layout(width = 6, height = 3) {
    return { width, height, fontSize: 1, lineHeight: 1, paragraphGap: 1 };
}

function measure(text, fontSize, lineHeight, width) {
    assert.ok(text.isWellFormed(), 'measurement must never receive a split surrogate pair');
    return Math.ceil(Array.from(text).length / width) * lineHeight;
}

function blocksOf(pages) {
    return pages.flatMap((page) => page.blocks);
}

function assertExactCoverage(paragraphs, pages) {
    const blocks = blocksOf(pages);
    assert.ok(pages.every((page) => page.blocks.length > 0), 'empty pages are not emitted');
    for (const original of paragraphs) {
        const fragments = blocks.filter((block) => block.paragraphIndex === original.index);
        assert.ok(fragments.length > 0, 'paragraph must keep its coverage: ' + original.index);
        let end = original.start;
        for (const fragment of fragments) {
            assert.equal(fragment.readStart, end, 'ranges are contiguous with no dropped whitespace');
            assert.ok(fragment.readEnd > fragment.readStart, 'each nonempty paragraph fragment covers a range');
            assert.ok(fragment.readEnd <= original.end, 'ranges never exceed their source paragraph');
            assert.ok(fragment.text.isWellFormed(), 'rendered fragments preserve surrogate pairs');
            const coveredText = Array.from(original.text).slice(
                fragment.readStart - original.start, fragment.readEnd - original.start).join('');
            if (fragment.kind !== ReaderBlockKind.IMAGE) {
                assert.ok(coveredText.includes(fragment.text), 'fragment coordinates point to its source text');
                assert.equal(coveredText.trim(), fragment.text.trim(), 'only whitespace is added to coverage');
            }
            end = fragment.readEnd;
        }
        assert.equal(end, original.end, 'last fragment covers the paragraph tail');
        if (original.kind !== 'image') {
            assert.equal(fragments.map((block) => block.text).join('').replace(/\s/g, ''),
                original.text.replace(/\s/g, ''), 'pagination neither loses nor duplicates text');
        }
    }
}

test('plain lengths count supplementary characters once and combining characters separately', () => {
    for (const text of ['', '中文', 'A😀𐐷B', 'e\u0301', '\ud800x\udc00', '😀'.repeat(100)]) {
        assert.equal(nxCodePointLength(text), Array.from(text).length);
    }
});

test('chapter API preserves absolute plain coordinates and START:LENGTH chapter ranges', async () => {
    const text = ' \t甲😀乙 \n';
    const image = '{{nxl_image:lecture:book:figure:图😀.png}}';
    enqueue({
        chapter_index: 2, chapter_title: '第三章', chapter_count: 4, chapter_start: 400,
        chapter_range: '400:80', coordinate_space: 'plain', book_total_chars: 1000,
        paragraphs: [
            { index: 20, kind: 'text', text, start: 400, end: 400 + Array.from(text).length },
            { index: 21, kind: 'image', text: image, start: 415, end: 415 + Array.from(image).length },
        ],
    });
    const result = await LearningApi.shared.getBookChapter('lecture', 'book', 2);
    assert.equal(result.success, true);
    assert.equal(result.content.chapterRange, '400:80');
    assert.equal(result.content.coordinateSpace, 'plain');
    assert.deepEqual(result.content.paragraphs, [
        paragraph(text, 400, 20), paragraph(image, 415, 21, 'image', 'figure'),
    ]);
    assert.deepEqual(requests, ['/api/lectures/lecture/books/book/chapter/2?paragraphs=1']);
});

test('unknown chapter coordinate spaces are preserved rather than guessed as plain', async () => {
    enqueue({ paragraphs: [], coordinate_space: 'raw', chapter_range: '2:20' });
    assert.equal((await LearningApi.shared.getBookChapter('l', 'b', 0)).content.coordinateSpace, 'raw');
    enqueue({ paragraphs: [] });
    const result = await LearningApi.shared.getBookChapter('l', 'b', 0);
    assert.equal(result.content.chapterRange, '');
    assert.equal(result.content.coordinateSpace, '');
});

test('single-page text covers leading and trailing whitespace', () => {
    const source = paragraph('\t  A😀  中文 \r\n');
    const pages = ReaderPaginator.paginate([source], layout(30, 4), measure);
    assert.equal(pages.length, 1);
    assertExactCoverage([source], pages);
    assert.equal(pages[0].blocks[0].gap, 0, 'the first block does not consume a phantom paragraph gap');
});

test('trimmed whitespace at page cuts contributes to the original plain cursor', () => {
    const source = paragraph(' \tA😀  B𐐷 C \r\n');
    const pages = ReaderPaginator.paginate([source], layout(3, 1), measure);
    assert.equal(pages.length, 3);
    assert.deepEqual(blocksOf(pages).map((block) => [block.readStart, block.readEnd]), [
        [100, 106], [106, 109], [109, source.end],
    ]);
    assertExactCoverage([source], pages);
});

test('whitespace-only paragraphs retain zero-height coverage', () => {
    const sources = [paragraph('\t  \n', 10, 0), paragraph('正文😀', 20, 1), paragraph('\u2003\u3000', 30, 2)];
    const pages = ReaderPaginator.paginate(sources, layout(10, 3), measure);
    assertExactCoverage(sources, pages);
    assert.equal(blocksOf(pages)[0].height, 0);
    assert.equal(blocksOf(pages).at(-1).height, 0);
});

test('long supplementary-text paragraphs keep exact ranges across many pages', () => {
    const source = paragraph('  ' + '𐐷😀甲乙  丙\t丁e\u0301 '.repeat(600) + '\n\t', 9000);
    const pages = ReaderPaginator.paginate([source], layout(35, 8), measure);
    assert.ok(pages.length > 20);
    assertExactCoverage([source], pages);
});

test('varying page dimensions never split surrogate pairs during binary search', () => {
    const source = paragraph('😀𐐷中文😀   𠮷𠮷字符 😀𐐷尾 '.repeat(9), 220);
    for (let width = 1; width <= 9; width++) {
        for (let height = 1; height <= 4; height++) {
            assertExactCoverage([source], ReaderPaginator.paginate([source], layout(width, height), measure));
        }
    }
});

test('a page shorter than one line still consumes whole code points and terminates', () => {
    const source = paragraph('😀𐐷中文');
    const dimensions = { width: 1, height: 1, fontSize: 20, lineHeight: 28, paragraphGap: 11 };
    const pages = ReaderPaginator.paginate([source], dimensions, measure);
    assert.equal(pages.length, 4);
    assertExactCoverage([source], pages);
});

test('text, headings, and images retain complete independent paragraph ranges', () => {
    const sources = [
        paragraph('第1章', 300, 1),
        paragraph('Unicode 字符😀', 305, 2),
        paragraph('  正文😀  𐐷内容 '.repeat(20), 340, 3),
        paragraph('{{nxl_image:l:b:diagram:图😀.png}}', 700, 4, 'image', 'diagram'),
        paragraph('最后一段 𐐷😀\t ', 750, 5),
    ];
    const pages = ReaderPaginator.paginate(sources, layout(8, 20), measure);
    assert.ok(pages.length > 1);
    assertExactCoverage(sources, pages);
    const images = blocksOf(pages).filter((block) => block.kind === ReaderBlockKind.IMAGE);
    assert.equal(images.length, 1);
    assert.deepEqual([images[0].readStart, images[0].readEnd], [sources[3].start, sources[3].end]);
    // Mirrors reading_progress.merge_read_ranges(strict=True) for a chapter containing these paragraphs.
    for (const block of blocksOf(pages)) {
        assert.ok(Number.isSafeInteger(block.readStart) && Number.isSafeInteger(block.readEnd));
        assert.ok(block.readStart >= 300 && block.readEnd <= 800 && block.readEnd > block.readStart);
    }
});

test('resolver selects the requested book and returns its full catalog', async () => {
    enqueue({ lecture: { id: '课程' }, books: [{ id: 'other' }, { id: 'book', title: '教材' }] }, {
        chapters: [{ chapter_index: 2, chapter_name: '第三章', sessions: [{ session_index: 0, session_name: '开始' }] }],
    });
    const target = await LearningApi.shared.resolveReaderTarget('课程', 'book');
    assert.equal(target.success, true);
    assert.equal(target.lecture.id, '课程');
    assert.equal(target.book.id, 'book');
    assert.equal(target.book.title, '教材');
    assert.equal(target.chapters[0].index, 2);
    assert.equal(target.chapters[0].sessions[0].name, '开始');
    assert.deepEqual(requests, ['/api/lectures/' + encodeURIComponent('课程'),
        '/api/lectures/' + encodeURIComponent('课程') + '/books/book/index']);
});

test('resolver rejects missing identifiers and books before requesting a catalog', async () => {
    requests.length = 0;
    const missingId = await LearningApi.shared.resolveReaderTarget(' ', 'book');
    assert.equal(missingId.success, false);
    assert.equal(requests.length, 0);
    enqueue({ lecture: { id: 'lecture' }, books: [{ id: 'other' }] });
    const missingBook = await LearningApi.shared.resolveReaderTarget('lecture', 'book');
    assert.equal(missingBook.success, false);
    assert.equal(missingBook.book, null);
    assert.equal(requests.length, 1);
});

test('resolver exposes network and catalog errors without returning a mountable success', async () => {
    enqueue();
    responses.push({ ok: false, payload: null, message: 'offline' });
    const offline = await LearningApi.shared.resolveReaderTarget('lecture', 'book');
    assert.equal(offline.success, false);
    assert.equal(offline.message, 'offline');
    assert.equal(requests.length, 1);
    enqueue({ lecture: { id: 'lecture' }, books: [{ id: 'book' }] }, { chapters: [] });
    const empty = await LearningApi.shared.resolveReaderTarget('lecture', 'book');
    assert.equal(empty.success, false);
    assert.equal(empty.message, '教材目录尚未就绪');
    enqueue({ lecture: { id: 'lecture' }, books: [{ id: 'book' }] });
    responses.push({ ok: false, payload: null, message: 'not ready' });
    const failedCatalog = await LearningApi.shared.resolveReaderTarget('lecture', 'book');
    assert.equal(failedCatalog.success, false);
    assert.equal(failedCatalog.message, 'not ready');
    assert.deepEqual(failedCatalog.chapters, []);
});
