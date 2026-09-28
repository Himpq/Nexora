/* Run with `node --test tools/test_soft_glow_conversation.cjs`.
 * Executes production Day, SoftGlowState, ReplyCancellation and AgentApi code.
 * ArkUI builders are removed by the existing harness; explicit Watch callbacks
 * model property notifications. Network/reveal gates expose real state transitions.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { environment } = require('./test_reading_progress.cjs');

const at = (day, hour, minute = 0, second = 0) => new Date(2026, 8, day, hour, minute, second).getTime();
const answer = text => ({ success: true, data: { answer: text, source: 'conversation' } });
const response = data => ({ responseCode: 200, result: JSON.stringify({ success: true, data }) });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function conversation() {
  const env = environment();
  env.setNow(at(21, 8));
  const state = env.load('services/SoftGlowState').sharedSoftGlowState;
  state.init({});
  const claims = [];
  const claim = state.claimFirstGlow.bind(state);
  state.claimFirstGlow = (...args) => {
    const allowed = claim(...args);
    claims.push({ args, allowed });
    return allowed;
  };
  const { DayView } = env.load('pages/Day');
  const day = new DayView();
  day.getUIContext = () => ({ getHostContext: () => undefined, setKeyboardAvoidMode() {} });
  day.questionTarget = async () => null;
  day.scrollToLatest = () => {};
  const reveals = [];
  day.revealAnswer = async (...args) => { reveals.push(args); };
  const calls = [];
  day.api = {
    postAskInContext(question, target, context, source, photo, cancellation) {
      const result = deferred();
      calls.push({ kind: 'ask', question, cancellation, result });
      return result.promise;
    },
    postPlan(intent, availableMinutes, cancellation) {
      const result = deferred();
      calls.push({ kind: 'plan', intent, cancellation, result });
      return result.promise;
    },
  };
  return { env, state, day, calls, claims, reveals };
}

function begin(day, text = 'Please explain the current topic') {
  day.inputText = text;
  return day.send();
}

test('a valid first send lights the top through waiting and revealing; the second send does not replay', async () => {
  const { env, day, calls, claims } = conversation();
  const reveal = deferred();
  day.revealAnswer = () => reveal.promise;
  const first = begin(day);
  assert.equal(day.sending, true);
  assert.equal(day.replyPhase, 'waiting');
  assert.equal(day.topGlow, true);
  assert.equal(claims.length, 1);
  await env.settle();
  calls[0].result.resolve(answer('First answer'));
  await env.settle();
  assert.equal(day.replyPhase, 'revealing');
  assert.equal(day.topGlow, true);
  assert.equal(day.sending, true);
  reveal.resolve();
  await first;
  assert.equal(day.replyPhase, 'complete');
  assert.equal(day.sending, false);
  assert.equal(day.topGlow, false);
  env.elapse(1000);
  const second = begin(day, 'A second question');
  assert.equal(day.topGlow, false);
  assert.equal(day.replyPhase, 'waiting');
  await env.settle();
  calls[1].result.resolve(answer('Second answer'));
  await second;
  assert.deepEqual(claims.map(item => item.allowed), [true, false]);
  assert.equal(day.entries.filter(entry => entry.kind === 'user_msg').length, 2);
});

test('empty and whitespace input spend no glow; duplicate taps preserve the next draft and make one request', async () => {
  const { env, day, calls, claims } = conversation();
  await begin(day, '');
  await begin(day, ' \n\t ');
  assert.equal(day.sending, false);
  assert.equal(day.topGlow, false);
  assert.equal(calls.length, 0);
  assert.equal(claims.length, 0);
  assert.equal(day.entries.length, 0);
  const pending = begin(day, '  A valid question  ');
  assert.equal(day.inputText, '');
  const version = day.replyVersion;
  day.inputText = 'draft written while waiting';
  await day.send();
  assert.equal(day.inputText, 'draft written while waiting');
  assert.equal(day.replyVersion, version);
  assert.equal(claims.length, 1);
  await env.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].question, 'A valid question');
  calls[0].result.resolve(answer('Done'));
  await pending;
});

test('an absent account cannot consume the day; signing in permits the first visible glow', async () => {
  const { env, day, calls, claims } = conversation();
  env.setUsername('');
  const anonymous = begin(day);
  assert.equal(day.topGlow, false);
  await env.settle();
  calls[0].result.reject(new Error('Sign in required'));
  await anonymous;
  env.setUsername('reader_a');
  env.elapse(1000);
  const authenticated = begin(day);
  assert.equal(day.topGlow, true);
  await env.settle();
  calls[1].result.resolve(answer('Signed in'));
  await authenticated;
  assert.deepEqual(claims.map(item => item.allowed), [false, true]);
});

test('errors extinguish the glow and retries keep the same message without claiming, even the next day', async () => {
  const { env, day, calls, claims } = conversation();
  const first = begin(day, 'A question to retry');
  await env.settle();
  calls[0].result.reject(new Error('fixture offline'));
  await first;
  assert.equal(day.replyPhase, 'error');
  assert.equal(day.sending, false);
  assert.equal(day.topGlow, false);
  const failed = day.entries.find(entry => entry.kind === 'user_msg');
  assert.equal(failed.status, 'failed');
  env.setNow(at(22, 8));
  const retry = day.resend(failed);
  assert.equal(day.topGlow, false);
  assert.equal(day.replyPhase, 'waiting');
  assert.equal(claims.length, 1, 'retry is excluded before calling the daily claim');
  await env.settle();
  calls[1].result.resolve(answer('Retried'));
  await retry;
  assert.equal(day.entries.filter(entry => entry.kind === 'user_msg').length, 1);
  assert.equal(day.entries.find(entry => entry.id === failed.id).status, undefined);
  assert.equal(day.replyPhase, 'complete');
  env.elapse(1000);
  const newSend = begin(day, 'A new question on day two');
  assert.equal(day.topGlow, true, 'retry did not consume the new day');
  await env.settle();
  calls[2].result.resolve(answer('New day'));
  await newSend;
});

for (const lateResult of ['success', 'failure']) {
  test('a stopped request with late ' + lateResult + ' cannot overwrite a new request or its glow', async () => {
    const { env, day, calls, claims, reveals } = conversation();
    env.setNow(at(21, 23, 59, 59));
    const old = begin(day, 'The first question');
    await env.settle();
    const firstControl = calls[0].cancellation;
    day.stopReply();
    assert.equal(firstControl.cancelled, true);
    assert.equal(day.sending, false);
    assert.equal(day.replyPhase, 'stopped');
    assert.equal(day.topGlow, false);
    assert.ok(day.entries.some(entry => /已停止/.test(entry.text)));
    env.setNow(at(22, 0));
    const current = begin(day, 'The next question');
    await env.settle();
    const currentControl = calls[1].cancellation;
    assert.notEqual(firstControl, currentControl);
    assert.equal(day.topGlow, true);
    if (lateResult === 'success') calls[0].result.resolve(answer('Stale answer'));
    else calls[0].result.reject(new Error('Stale failure'));
    await old;
    assert.equal(day.replyCancellation, currentControl);
    assert.equal(currentControl.cancelled, false);
    assert.equal(day.sending, true);
    assert.equal(day.replyPhase, 'waiting');
    assert.equal(day.topGlow, true);
    assert.equal(reveals.length, 0);
    assert.equal(env.storage.has('nxStudyTick'), false);
    calls[1].result.resolve(answer('Current answer'));
    await current;
    assert.equal(day.replyPhase, 'complete');
    assert.equal(day.topGlow, false);
    assert.equal(reveals.length, 1);
    assert.equal(reveals[0][1], 'Current answer');
    assert.deepEqual(claims.map(item => item.allowed), [true, true]);
  });
}

test('stopping while context resolves prevents starting a request and preserves next-day eligibility', async () => {
  const { env, day, calls, claims } = conversation();
  const context = deferred();
  day.questionTarget = () => context.promise;
  env.setNow(at(21, 23, 59, 59));
  const old = begin(day);
  assert.equal(day.topGlow, true);
  day.stopReply();
  env.setNow(at(22, 0));
  context.resolve(null);
  await old;
  assert.equal(calls.length, 0);
  assert.equal(claims.length, 1);
  assert.equal(day.replyPhase, 'stopped');
  day.questionTarget = async () => null;
  const next = begin(day);
  assert.equal(day.topGlow, true);
  await env.settle();
  calls[0].result.resolve(answer('Next day'));
  await next;
});

test('an in-flight request crossing midnight never claims again; the next new send does', async () => {
  const { env, day, calls, claims } = conversation();
  const submittedAt = at(21, 23, 59, 59);
  env.setNow(submittedAt);
  const overnight = begin(day);
  await env.settle();
  env.setNow(at(22, 0));
  day.refreshDayLabels();
  day.onGlowVisibilityChanged();
  assert.equal(claims.length, 1);
  assert.equal(claims[0].args[2], submittedAt);
  calls[0].result.resolve(answer('Arrived after midnight'));
  await overnight;
  assert.equal(claims.length, 1);
  assert.equal(day.topGlow, false);
  const next = begin(day);
  assert.equal(day.topGlow, true);
  await env.settle();
  calls[1].result.resolve(answer('New day'));
  await next;
  assert.deepEqual(claims.map(item => item.allowed), [true, true]);
});

const hiddenStates = [
  ['glowEnabled', false], ['appForeground', false], ['homeVisible', false],
  ['studyOpen', true], ['inspectOpen', true], ['glowSettingsOpen', true],
];

test('a send started disabled or hidden does not consume the first glow or replay it when exposed', async () => {
  for (const [property, hiddenValue] of hiddenStates) {
    const { env, day, calls, claims } = conversation();
    day[property] = hiddenValue;
    day.onGlowVisibilityChanged();
    const hiddenSend = begin(day);
    assert.equal(day.topGlow, false, property);
    assert.equal(claims.length, 0, property);
    day[property] = !hiddenValue;
    day.onGlowVisibilityChanged();
    assert.equal(day.topGlow, false, property + ' cannot replay an in-flight send');
    assert.equal(claims.length, 0, property);
    await env.settle();
    calls[0].result.resolve(answer('Hidden send finished'));
    await hiddenSend;
    env.elapse(1000);
    const visibleSend = begin(day);
    assert.equal(day.topGlow, true, property + ' leaves the first actual presentation available');
    await env.settle();
    calls[1].result.resolve(answer('Visible send'));
    await visibleSend;
  }
});

test('after a glow was shown, hiding or disabling extinguishes it and reopening cannot replay it', async () => {
  for (const [property, hiddenValue] of hiddenStates) {
    const { env, day, calls, claims } = conversation();
    const pending = begin(day);
    assert.equal(day.topGlow, true);
    day[property] = hiddenValue;
    day.onGlowVisibilityChanged();
    assert.equal(day.topGlow, false, property);
    day[property] = !hiddenValue;
    day.onGlowVisibilityChanged();
    assert.equal(day.topGlow, false, property + ' cannot restore a consumed presentation');
    assert.equal(claims.length, 1);
    await env.settle();
    calls[0].result.resolve(answer('Finished'));
    await pending;
    env.elapse(1000);
    const second = begin(day);
    assert.equal(day.topGlow, false, property + ' remains consumed for subsequent sends');
    await env.settle();
    calls[1].result.resolve(answer('Second'));
    await second;
    assert.deepEqual(claims.map(item => item.allowed), [true, false]);
  }
});

test('leaving the component cancels its request and a late response cannot resume the glow', async () => {
  const { env, day, calls, claims, reveals } = conversation();
  const pending = begin(day);
  await env.settle();
  const control = calls[0].cancellation;
  day.aboutToDisappear();
  assert.equal(control.cancelled, true);
  assert.equal(day.replyCancellation, null);
  assert.equal(day.topGlow, false);
  assert.equal(day.attached, false);
  calls[0].result.resolve(answer('Arrived after leaving'));
  await pending;
  assert.equal(day.topGlow, false);
  assert.equal(reveals.length, 0);
  assert.equal(claims.length, 1);
  assert.equal(env.storage.has('nxStudyTick'), false);
});

test('production character reveal stops changing text after stop and cannot finish a later request', async () => {
  const { env, day, calls } = conversation();
  const { DayView } = env.load('pages/Day');
  day.revealAnswer = DayView.prototype.revealAnswer;
  const first = begin(day);
  await env.settle();
  calls[0].result.resolve(answer('A sufficiently long answer to stop during its character reveal.'));
  await env.settle();
  assert.equal(day.replyPhase, 'revealing');
  const oldThinkingId = day.activeThinkingId;
  day.stopReply();
  const stoppedText = day.entries.find(entry => entry.id === oldThinkingId).text;
  assert.match(stoppedText, /已停止回复/);
  env.elapse(1000);
  day.revealAnswer = async () => {};
  const next = begin(day, 'A different question');
  await env.tick(30);
  await first;
  assert.equal(day.entries.find(entry => entry.id === oldThinkingId).text, stoppedText);
  assert.equal(day.sending, true);
  assert.equal(day.replyPhase, 'waiting');
  calls[1].result.resolve(answer('New answer'));
  await next;
});

test('the plan route shares the daily glow and passes its own cancellation control to the network', async () => {
  const { env, day, calls } = conversation();
  const pending = begin(day, '开始学习');
  assert.equal(day.topGlow, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'plan');
  assert.equal(calls[0].cancellation, day.replyCancellation);
  calls[0].result.resolve({ success: true, data: { plan: {
    target: { lecture_id: 'l', lecture_title: 'L', book_id: 'b', book_title: 'B',
      chapter_index: 0, chapter_name: 'Chapter', chapter_range: '0:10' },
    estimated_minutes: 30, reason: 'A small next step',
  } } });
  await pending;
  assert.equal(day.replyPhase, 'complete');
  assert.equal(day.sending, false);
  assert.equal(day.topGlow, false);
  assert.equal(day.entries.filter(entry => entry.card?.type === 'plan').length, 1);
  await env.settle();
});

test('AgentApi cancels only the matching HTTP request and leaves the next send and timeline request alive', async () => {
  const env = environment();
  const { AgentApi } = env.load('services/AgentApi');
  const { ReplyCancellation } = env.load('services/ReplyCancellation');
  const api = new AgentApi();
  const firstControl = new ReplyCancellation();
  const secondControl = new ReplyCancellation();
  const gates = [];
  env.setHttpHandler(request => {
    const gate = deferred();
    gates.push({ request, gate });
    return gate.promise;
  });
  const first = api.postAskInContext('first', null, '', 'app', '', firstControl);
  const second = api.postAskInContext('second', null, '', 'app', '', secondControl);
  const timeline = api.getEvents(10);
  const firstRejected = assert.rejects(first, /fixture request destroyed/);
  await env.settle();
  assert.equal(gates.length, 3);
  firstControl.cancel();
  firstControl.cancel();
  await firstRejected;
  assert.equal(gates[0].request.client.destroyCount, 1);
  assert.equal(gates[1].request.client.destroyed, false);
  assert.equal(gates[2].request.client.destroyed, false);
  gates[1].gate.resolve(response({ answer: 'second' }));
  gates[2].gate.resolve(response({ entries: [] }));
  assert.equal((await second).data.answer, 'second');
  assert.equal((await timeline).data.entries.length, 0);
  secondControl.cancel();
  assert.equal(gates[1].request.client.destroyCount, 1, 'completed request unbinds its cancellation handler');
  gates[0].gate.resolve(response({ answer: 'obsolete' }));
  await env.settle();
  assert.equal(gates[0].request.client.destroyCount, 1);
});

test('a cancellation before identity is ready creates no HTTP request', async () => {
  const env = environment();
  const { AgentApi } = env.load('services/AgentApi');
  const { ReplyCancellation } = env.load('services/ReplyCancellation');
  const ready = deferred();
  env.setIdentityGate(ready.promise);
  const control = new ReplyCancellation();
  const pending = new AgentApi().postPlan('开始学习', 30, control);
  const rejected = assert.rejects(pending, /回复已停止/);
  control.cancel();
  ready.resolve();
  await rejected;
  assert.equal(env.requests.length, 0);
  assert.equal(env.httpClients.length, 0);
  assert.throws(() => control.bind(() => {}), /回复已停止/);
});

test('Day stop interrupts its production AgentApi transport immediately and remains a stopped state', async () => {
  const { env, day } = conversation();
  const { AgentApi } = env.load('services/AgentApi');
  const network = deferred();
  env.setHttpHandler(() => network.promise);
  day.api = new AgentApi();
  const pending = begin(day);
  await env.settle();
  assert.equal(env.requests.length, 1);
  const client = env.requests[0].client;
  assert.equal(client.destroyed, false);
  day.stopReply();
  assert.equal(client.destroyed, true);
  await pending;
  assert.equal(day.replyPhase, 'stopped');
  assert.equal(day.sending, false);
  assert.equal(day.topGlow, false);
  assert.equal(client.destroyCount, 1);
  network.resolve(response({ answer: 'Too late', source: 'conversation' }));
  await env.settle();
  assert.equal(day.replyPhase, 'stopped');
});

// Keep the main harness unchanged: execute the actual window-subscription body
// with a local platform window and evaluate the actual ArkUI positioning bindings.
// These checks verify coordinate calculations, not the native rendered geometry.
const daySource = fs.readFileSync(path.resolve(__dirname, '../entry/src/main/ets/pages/Day.ets'), 'utf8');

function glowPosition(day, placement, edge) {
  const start = daySource.indexOf("placement: '" + placement + "'");
  assert.ok(start >= 0, 'the production glow placement exists');
  const position = daySource.slice(start).match(/\.position\(\{([^}]+)\}\)/);
  assert.ok(position, 'the production glow has a position binding');
  const expression = position[1].match(new RegExp('\\b' + edge + ':\\s*([^,]+)'));
  assert.ok(expression, 'the production glow position has a ' + edge + ' coordinate');
  return vm.runInNewContext('(function() { return (' + expression[1] + '); })').call(day);
}

test('keyboard height is converted once and navigation is subtracted only once through show, resize and hide', () => {
  const { day } = conversation();
  day.getUIContext = () => ({ px2vp: pixels => pixels / 3.5 });
  day.navigationBottomInset = 28; // The platform's 98 px navigation indicator at 3.5 px/vp.
  day.systemTopInset = 32;
  day.showBackTop = true;
  assert.equal(glowPosition(day, 'top', 'top'), -32);
  for (const [pixels, fullHeight, contentInset, ambientBottom] of [
    [0, 0, 0, -28], [700, 200, 172, 172], [1050, 300, 272, 272],
    [350, 100, 72, 72], [0, 0, 0, -28], [-1, 0, 0, -28],
  ]) {
    day.applyKeyboardPx(pixels);
    assert.equal(day.keyboardHeight, fullHeight, 'raw keyboard height at ' + pixels + ' px');
    assert.equal(day.keyboardInset, contentInset, 'safe content offset at ' + pixels + ' px');
    assert.equal(glowPosition(day, 'composer', 'bottom'), ambientBottom,
      'the decorative layer extends below the safe content when the keyboard closes');
  }
});

test('window subscriptions read and track TYPE_NAVIGATION_INDICATOR independently from the status bar', async () => {
  const { env, day } = conversation();
  const tsPath = process.env.NEXORA_TYPESCRIPT_PATH ||
    'C:/Program Files/Huawei/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript/lib/typescript.js';
  const ts = require(tsPath);
  const method = daySource.match(/\n  private listenKeyboard\(\): void \{([\s\S]*?)\n  \}/);
  assert.ok(method, 'the production keyboard-subscription method exists');
  const compiled = ts.transpileModule('(function() {' + method[1] + '\n})', {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const callbacks = new Map();
  const queried = [];
  const types = { TYPE_SYSTEM: 0, TYPE_KEYBOARD: 3, TYPE_NAVIGATION_INDICATOR: 4 };
  let keyboardPixels = 0;
  const area = (top, bottom) => ({ visible: top > 0 || bottom > 0, topRect: { height: top }, bottomRect: { height: bottom, top: 0 } });
  const platformWindow = {
    getWindowAvoidArea(type) {
      queried.push(type);
      if (type === types.TYPE_SYSTEM) return area(112, 0);
      if (type === types.TYPE_NAVIGATION_INDICATOR) return area(0, 98);
      if (type === types.TYPE_KEYBOARD) return area(0, keyboardPixels);
      throw new Error('Unexpected avoid-area query: ' + type);
    },
    on(event, callback) { callbacks.set(event, callback); },
  };
  day.getUIContext = () => ({ getHostContext: () => ({}), px2vp: pixels => pixels / 3.5 });
  day.showBackTop = true;
  vm.runInNewContext(compiled, {
    window: { AvoidAreaType: types, getLastWindow: async () => platformWindow },
    nxApplySystemBars() {},
  }).call(day);
  await env.settle();
  assert.ok(queried.includes(types.TYPE_NAVIGATION_INDICATOR));
  assert.equal(day.navigationBottomInset, 28);
  assert.equal(day.systemTopInset, 32);
  keyboardPixels = 700;
  callbacks.get('keyboardHeightChange')(keyboardPixels);
  assert.equal(day.keyboardInset, 172);
  callbacks.get('avoidAreaChange')({ type: types.TYPE_NAVIGATION_INDICATOR, area: area(0, 70) });
  assert.equal(day.navigationBottomInset, 20);
  assert.equal(day.keyboardInset, 180, 'navigation changes recompute the current keyboard offset');
  assert.equal(glowPosition(day, 'composer', 'bottom'), 180);
  callbacks.get('avoidAreaChange')({ type: types.TYPE_SYSTEM, area: area(140, 0) });
  assert.equal(day.systemTopInset, 40);
  assert.equal(day.navigationBottomInset, 20, 'a status-bar update cannot erase the navigation inset');
  assert.equal(glowPosition(day, 'top', 'top'), -40);
  keyboardPixels = 0;
  callbacks.get('avoidAreaChange')({ type: types.TYPE_KEYBOARD, area: area(0, 0) });
  assert.equal(day.keyboardHeight, 0);
  assert.equal(day.keyboardInset, 0);
  assert.equal(glowPosition(day, 'composer', 'bottom'), -20);
});

function glyphEnvironment() {
  const { day } = conversation();
  const tsPath = process.env.NEXORA_TYPESCRIPT_PATH ||
    'C:/Program Files/Huawei/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript/lib/typescript.js';
  const ts = require(tsPath);
  const method = daySource.match(/\n  private syncGlyphMotion\(\): void \{([\s\S]*?)\n  \}/);
  assert.ok(method, 'the production glyph lifecycle method exists');
  const compiled = ts.transpileModule('(function() {' + method[1] + '\n})', {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
  }).outputText;
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  const scheduled = [];
  // Replace only timer facilities around the unchanged production method body.
  // Day lifecycle and visibility methods still call this method through `this`.
  day.syncGlyphMotion = vm.runInNewContext(compiled, {
    setTimeout(callback, delay) {
      const timer = { id: nextId++, callback, due: now + delay, delay };
      pending.set(timer.id, timer);
      scheduled.push(timer);
      return timer.id;
    },
    clearTimeout(id) { pending.delete(id); },
  });
  day.listenKeyboard = () => {};
  day.scheduleMidnight = () => {};
  day.load = async () => {};
  return {
    day, pending, scheduled,
    watch(property, value) { day[property] = value; day.onGlowVisibilityChanged(); },
    advance(ms) {
      now += ms;
      for (const timer of [...pending.values()]) {
        if (timer.due > now) continue;
        pending.delete(timer.id);
        timer.callback();
      }
    },
  };
}

test('the brand glyph starts once after mounting and a full 60 ms delay', () => {
  const env = glyphEnvironment();
  const { day } = env;
  day.onGlowVisibilityChanged();
  assert.equal(day.attached, false);
  assert.equal(day.breathe, false);
  assert.equal(env.pending.size, 0);
  day.aboutToAppear();
  assert.equal(day.attached, true);
  assert.equal(day.motionAllowed(), true);
  assert.equal(day.breathe, false);
  assert.equal(env.pending.size, 1);
  assert.equal(env.scheduled[0].delay, 60);
  env.advance(59);
  assert.equal(day.breathe, false);
  env.advance(1);
  assert.equal(day.breathe, true);
  assert.equal(day.glyphTimer, -1);
  assert.equal(env.pending.size, 0);
  env.advance(60000);
  assert.equal(env.scheduled.length, 1, 'native animation needs no recurring JS start timer');
});

test('reduced motion and hidden states cancel glyph startup; stale callbacks cannot start the new animated branch early', () => {
  for (const [property, suppressed] of [
    ['glowReduceMotion', true], ['systemReduceMotion', true],
    ['appForeground', false], ['homeVisible', false],
    ['studyOpen', true], ['inspectOpen', true], ['glowSettingsOpen', true],
  ]) {
    const env = glyphEnvironment();
    const { day } = env;
    day.aboutToAppear();
    const previous = env.scheduled.at(-1);
    env.advance(30);
    env.watch(property, suppressed);
    assert.equal(day.motionAllowed(), false, property);
    assert.equal(day.breathe, false, property);
    assert.equal(day.glyphTimer, -1, property);
    assert.equal(env.pending.size, 0, property);
    previous.callback();
    assert.equal(day.breathe, false, property + ' rejects its queued old callback');
    env.watch(property, !suppressed);
    const current = env.scheduled.at(-1);
    assert.notEqual(previous.id, current.id);
    assert.equal(day.motionAllowed(), true);
    assert.equal(day.breathe, false);
    previous.callback();
    assert.equal(day.breathe, false, property + ' cannot start the replacement branch early');
    assert.equal(day.glyphTimer, current.id, property + ' retains the new startup handle');
    assert.equal(env.pending.size, 1);
    env.advance(59);
    assert.equal(day.breathe, false);
    env.advance(1);
    assert.equal(day.breathe, true, property + ' restarts after the replacement branch can mount');
    assert.equal(env.pending.size, 0);
    env.watch(property, suppressed);
    assert.equal(day.breathe, false, property + ' also stops an already started glyph');
    assert.equal(day.motionAllowed(), false);
    assert.equal(env.pending.size, 0);
  }
});

test('glyph disappearance clears startup and a later mount is isolated from the old queued callback', () => {
  const env = glyphEnvironment();
  const { day } = env;
  day.aboutToAppear();
  const previous = env.scheduled.at(-1);
  day.aboutToDisappear();
  assert.equal(day.attached, false);
  assert.equal(day.glyphTimer, -1);
  assert.equal(day.breathe, false);
  assert.equal(env.pending.size, 0);
  previous.callback();
  assert.equal(day.breathe, false);
  day.aboutToAppear();
  const current = env.scheduled.at(-1);
  previous.callback();
  assert.equal(day.breathe, false);
  assert.equal(day.glyphTimer, current.id);
  assert.equal(env.pending.size, 1);
  env.advance(60);
  assert.equal(day.breathe, true);
  assert.equal(env.pending.size, 0);
  day.aboutToDisappear();
  assert.equal(day.breathe, false);
  assert.equal(env.pending.size, 0);
});
