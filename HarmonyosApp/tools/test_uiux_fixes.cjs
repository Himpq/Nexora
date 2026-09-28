/* 2026-09-21 UI/UX 审查修复的回归。Run with `node --test tools/test_uiux_fixes.cjs`.
 * 复用 test_reading_progress.cjs 的 harness（生产 ArkTS 方法 + 隔离的网络 / 存储）。
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { environment } = require('./test_reading_progress.cjs');

/** 沙箱里创建的数组原型不同于主 realm，比较前先经 JSON 归一。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

test('changing the colour of part of a highlight keeps the untouched parts of the original mark', () => {
  const env = environment();
  const reader = env.reader();
  const { nxSubtractMarks, nxMergeAdjacentMarks } = env.load('pages/Reader', true);
  reader.marks = [{ paraIndex: 0, start: 0, end: 100, style: 'solid', color: 'yellow' }];
  reader.snapPara = 0; reader.snapStart = 40; reader.snapEnd = 60; reader.snapText = 'x';
  reader.persistMarks = () => {};
  reader.readerApi.postTelemetry = async () => true;
  reader.applyMark('mark', 'green');
  const spans = plain(reader.marks.map(m => [m.start, m.end, m.color])).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(spans, [[0, 40, 'yellow'], [40, 60, 'green'], [60, 100, 'yellow']]);
  reader.removeSnapshotMarks();
  assert.deepEqual(plain(reader.marks.map(m => [m.start, m.end])).sort((a, b) => a[0] - b[0]), [[0, 40], [60, 100]]);
  const merged = nxMergeAdjacentMarks([
    { paraIndex: 0, start: 0, end: 40, style: 'solid', color: 'yellow' },
    { paraIndex: 0, start: 40, end: 60, style: 'solid', color: 'yellow' },
  ]);
  assert.deepEqual(plain(merged.map(m => [m.start, m.end])), [[0, 60]]);
  assert.equal(nxSubtractMarks([{ paraIndex: 1, start: 0, end: 5, style: 'solid', color: 'yellow' }], 0, 0, 5).length, 1);
});

test('a very long paragraph is never truncated by the pagination guard', () => {
  const env = environment();
  const reader = env.reader();
  reader.measureHeight = (text) => text.length;
  const chunks = reader.splitToFit('a'.repeat(10000), 0, 100);
  assert.equal(chunks.join('').length, 10000);
  assert.ok(chunks.length >= 100);
});

test('an answer that arrives after switching chapters does not land in the new chapter', async () => {
  const env = environment();
  const reader = env.reader();
  reader.onPageShow();
  await reader.load();
  let release;
  reader.agentApi = { postAskInContext: () => new Promise(resolve => { release = resolve; }) };
  reader.readerApi.postTelemetry = async () => true;
  const asking = reader.ask('what is this');
  await reader.loadChapter(1);
  release({ data: { answer: 'Answer about chapter 0', source: 'textbook_context' } });
  await asking;
  assert.equal(reader.askTurns.length, 0);
  assert.equal(reader.asking, false);
  reader.agentApi = { postAskInContext: async () => ({ data: { answer: 'general', source: 'general_knowledge_fallback' } }) };
  await reader.ask('why');
  const answer = reader.askTurns[reader.askTurns.length - 1];
  assert.match(answer.reason, /通用知识/);
  assert.equal(answer.card.chapter, 'Chapter 1');
});

test('negations and quoted phrases are questions, not plan commands; calendar needs explicit intent', () => {
  const env = environment();
  const { nxIsLearningIntent, nxWantsCalendar } = env.load('pages/Day');
  assert.equal(nxIsLearningIntent('开始学习'), true);
  assert.equal(nxIsLearningIntent('今天学什么'), true);
  assert.equal(nxIsLearningIntent('帮我安排今天的学习'), true);
  assert.equal(nxIsLearningIntent('我不想开始学习，请解释什么是事务'), false);
  assert.equal(nxIsLearningIntent('请解释‘今天学什么’这句话的意思'), false);
  assert.equal(nxIsLearningIntent('下一章讲的是什么？'), false);
  assert.equal(nxWantsCalendar('开始学习'), false);
  assert.equal(nxWantsCalendar('帮我安排学习并提醒我'), true);
});

test('a failed send keeps the message as failed, survives a timeline refresh, and can be resent', async () => {
  const env = environment();
  const { DayView } = env.load('pages/Day');
  const day = new DayView();
  day.inputText = 'a long question that must not be lost';
  day.questionTarget = async () => null;
  day.revealAnswer = async () => {};
  day.scrollToLatest = () => {};
  day.deriveStatus = () => {};
  day.handleProactiveEntries = () => {};
  day.getUIContext = () => ({ getHostContext: () => undefined });
  let fail = true;
  day.api = {
    postAskInContext: async () => { if (fail) throw new Error('offline'); return { data: { answer: 'ok', source: 'conversation' } }; },
    getEvents: async () => ({ data: { entries: [{ id: 'server_1', kind: 'agent_msg', ts: 1, text: 'old', unattended: false }] } }),
  };
  await day.send();
  const failed = day.entries.find(e => e.kind === 'user_msg');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.text, 'a long question that must not be lost');
  assert.equal(day.inputText, '');
  await day.loadEvents();
  assert.ok(day.entries.some(e => e.id === failed.id && e.status === 'failed'), 'failed message survives refresh');
  fail = false;
  await day.resend(failed);
  const sent = day.entries.find(e => e.id === failed.id);
  assert.equal(sent.status, undefined);
  assert.equal(day.localPending.length, 0);
  fail = true;
  day.inputText = 'second';
  await day.send();
  const second = day.entries.find(e => e.kind === 'user_msg' && e.text === 'second');
  day.editFailed(second);
  assert.equal(day.inputText, 'second');
  assert.equal(day.entries.some(e => e.id === second.id), false);
});

test('a review attempt is isolated: the same quiz id in a new round starts unanswered and submits with attempt_id', async () => {
  const env = environment();
  const { TodayTask } = env.load('pages/TodayTask');
  const task = new TodayTask();
  task.getUIContext = () => ({ getHostContext: () => undefined, px2vp: v => v });
  task.books = [{ key: 'l/b', lectureId: 'l', lectureTitle: 'L', bookId: 'b', bookTitle: 'B', chapterIndex: 2, chapterTitle: 'Ch' }];
  task.chosenKey = 'l/b';
  task.chapterIndex = 2;
  const submits = [];
  let round = 0;
  task.api = {
    postReviewPlan: async () => { round++; return { data: { task: { task_id: 'task_' + round, status: 'queued' } } }; },
    getTask: async (id) => ({ data: { task: { status: 'completed', result: {
      quiz_id: 'chapter_quiz_same', attempt_id: id, lecture_id: 'l', book_id: 'b', chapter_index: 2, chapter_name: 'Ch',
      questions: [{ type: 'choice', title: 'q', content: 'q', difficulty: '', hint: '', answer: 'A', options: ['x', 'y'], source: '', source_id: 'q1' }],
    } } } }),
    postReviewSubmit: async (quizId, target, answers, attemptId) => {
      submits.push({ quizId, target, answers, attemptId });
      return { data: { quiz_id: quizId, attempt_id: attemptId, score: '1/1', correct: 1, total: 1,
        items: [{ question_id: 'q1', is_correct: true }], quiz_correct: 1, quiz_total: 1, quiz_settled: 1, completed: true } };
    },
  };
  await task.startReview();
  await task.pollTask('task_1', task.reviewVersion);
  assert.equal(task.attemptId, 'task_1');
  assert.equal(task.states[0].picked, '');
  task.chapterIndex = 7;
  task.states[0].picked = 'x';
  await task.settleQuestion(0);
  assert.equal(submits[0].attemptId, 'task_1');
  assert.equal(submits[0].target.chapter_index, 2);
  assert.equal(task.submitted, true);
  assert.equal(task.originDiffers(), true);
  await task.startReview();
  await task.pollTask('task_2', task.reviewVersion);
  assert.equal(task.attemptId, 'task_2');
  assert.equal(task.submitted, false);
  assert.equal(task.states[0].settled, false);
  task.states[0].picked = 'y';
  await task.pollTask('task_1', task.reviewVersion - 1);
  assert.equal(task.states[0].picked, 'y');
});

test('proactive card failure keeps the decision pending with a retry instead of "no more reminders"', async () => {
  const env = environment();
  const { TimelineEntryView } = env.load('components/entry/TimelineEntryView');
  const view = new TimelineEntryView();
  view.entry = { id: 'd1', kind: 'agent_act', ts: 1, text: 't', unattended: true, status: 'pending',
    card: { type: 'proactive', title: 't', reason: '', minutes: 5, accept: 'a', defer: 'd', dismiss: 'x' } };
  let calls = 0;
  view.api = { postDecisionRespond: async () => { calls++; if (calls === 1) throw new Error('offline'); return { next_actions: [] }; } };
  let opened = 0;
  view.onOpenSession = () => { opened++; };
  await view.respond('accept');
  assert.equal(view.entry.status, 'pending');
  assert.ok(view.respondError.length > 0);
  assert.equal(view.lastResponse, 'accept');
  await view.respond('accept');
  assert.equal(view.entry.status, 'accept');
  assert.equal(view.respondError, '');
  assert.equal(opened, 1);
});

test('time phases are consistent across header, dots and autonomy labels', () => {
  const env = environment();
  const rows = env.load('components/entry/TimelineRows');
  const at = (h) => new Date(2026, 8, 21, h, 30).getTime();
  assert.equal(rows.nxTimePhase(at(22)), 'night');
  assert.equal(rows.nxTimePhase(at(6)), 'night');
  assert.equal(rows.nxTimePhase(at(7)), 'dawn');
  assert.equal(rows.nxTimePhase(at(10)), 'dawn');
  assert.equal(rows.nxTimePhase(at(12)), 'day');
});

test('markdown keeps set braces, nested fractions, ordered numbers and tables instead of deleting structure', () => {
  const env = environment();
  const md = env.load('components/common/MarkdownView');
  assert.equal(md.renderLatex('\\left\\{ x \\right\\}'), '{ x }');
  assert.equal(md.renderLatex('\\frac{1}{\\sqrt{x}}'), '(1)/(√(x))');
  assert.equal(md.renderLatex('\\begin{cases} a \\\\ b \\end{cases}'), '\\begin{cases} a \\\\ b \\end{cases}');
  const blocks = md.parseMarkdown('1. first\n2. second\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  assert.equal(blocks[0].kind, 'ol');
  assert.equal(blocks[0].ordinal, '1.');
  assert.equal(blocks[1].ordinal, '2.');
  assert.equal(blocks[2].kind, 'table');
  assert.equal(JSON.stringify(blocks[2].rows), JSON.stringify([['a', 'b'], ['1', '2']]));
});
