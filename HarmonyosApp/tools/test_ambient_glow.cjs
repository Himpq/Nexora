/* Run with `node --test tools/test_ambient_glow.cjs`.
 * Executes the production AmbientGlow lifecycle, Watch callbacks and timing
 * methods with a deterministic clock. This is not rendering or FPS evidence.
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

function removeBuild(source) {
  const match = /\n  build\(\)\s*\{/.exec(source);
  assert.ok(match, 'the production component has an ArkUI build method');
  const start = source.indexOf('{', match.index);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source.slice(start));
  let depth = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.OpenBraceToken) depth++;
    if (token === ts.SyntaxKind.CloseBraceToken && --depth === 0) {
      return source.slice(0, match.index) + source.slice(start + scanner.getTextPos());
    }
  }
  throw new Error('Cannot isolate the ArkUI build method');
}

function environment(placement = 'composer') {
  let now = 100000;
  let nextId = 1;
  const pending = new Map();
  const scheduled = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const filename = path.join(sourceRoot, relative + '.ets');
    let source = fs.readFileSync(filename, 'utf8');
    if (relative === 'components/AmbientGlow') {
      source = removeBuild(source).replace(/\bstruct AmbientGlow\b/, 'class AmbientGlow')
        .replace(/@(?:Component|Prop|State)\b/g, '')
        .replace(/@Watch\([^)]*\)/g, '') + '\nexports.AmbientGlow = AmbientGlow;';
    }
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
      fileName: filename,
      reportDiagnostics: true,
    });
    const errors = (compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, 'production non-UI source must transpile');
    const exported = {};
    vm.runInNewContext(compiled.outputText, {
      exports: exported,
      Date: Clock,
      setTimeout(callback, delay) {
        const timer = { id: nextId++, callback, at: now + delay, delay };
        pending.set(timer.id, timer);
        scheduled.push(timer);
        return timer.id;
      },
      clearTimeout(id) { pending.delete(id); },
      setInterval() { throw new Error('AmbientGlow must not schedule a repeating timer'); },
      require(specifier) {
        if (specifier === '../theme/AmbientTokens') return load('theme/AmbientTokens');
        throw new Error('Unexpected component dependency: ' + specifier);
      },
    }, { filename });
    modules.set(relative, exported);
    return exported;
  }
  const { AmbientGlow } = load('components/AmbientGlow');
  const { NxAmbientMotion } = load('theme/AmbientTokens');
  const glow = new AmbientGlow();
  glow.placement = placement;
  return {
    glow, pending, scheduled, motion: NxAmbientMotion,
    get now() { return now; },
    mount() { glow.aboutToAppear(); },
    watch(property, value) { glow[property] = value; glow.synchronize(); },
    elapse(ms) { now += ms; },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...pending.values()].filter(timer => timer.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        pending.delete(next.id);
        now = Math.max(now, next.at);
        next.callback();
      }
      now = target;
    },
  };
}

for (const placement of ['composer', 'top']) {
  test(placement + ': idle is static without timers; activity becomes quiet after ten seconds', () => {
    const env = environment(placement);
    const { glow, motion } = env;
    env.mount();
    assert.equal(env.pending.size, 0);
    assert.equal(glow.drift, false);
    assert.equal(glow.quiet, false);
    if (placement === 'top') assert.equal(glow.strength(), 0);
    env.watch('illuminated', true);
    env.watch('busy', true);
    const activeStrength = glow.strength();
    assert.equal(glow.drift, true);
    assert.equal(glow.motionDuration(), motion.drift);
    assert.equal(env.pending.size, 1);
    env.advance(motion.quietAfter - 1);
    assert.equal(glow.quiet, false);
    assert.equal(glow.strength(), activeStrength);
    env.advance(1);
    assert.equal(glow.quiet, true);
    assert.equal(glow.drift, false);
    assert.ok(glow.strength() < activeStrength);
    assert.equal(glow.motionDuration(), motion.fade);
    assert.equal(env.pending.size, 0);
    const timerCount = env.scheduled.length;
    env.advance(60000);
    assert.equal(env.scheduled.length, timerCount, 'long answers do not restart a drift loop');
  });

  test(placement + ': reduced motion has no drift but still lowers intensity after ten seconds', () => {
    const env = environment(placement);
    const { glow, motion } = env;
    glow.reducedMotion = true;
    glow.busy = true;
    glow.illuminated = true;
    env.mount();
    const initial = glow.strength();
    assert.equal(glow.drift, false);
    assert.equal(glow.motionDuration(), 0);
    assert.equal(env.pending.size, 1, 'one quieting deadline is independent from decorative motion');
    env.advance(motion.quietAfter);
    assert.equal(glow.quiet, true);
    assert.equal(glow.motionDuration(), 0);
    assert.ok(glow.strength() < initial);
    assert.equal(env.pending.size, 0);
  });
}

test('hiding or disabling clears timers and returning uses the original request age', () => {
  for (const property of ['exposed', 'glowEnabled']) {
    const env = environment();
    const { glow, motion } = env;
    glow.busy = true;
    env.mount();
    const beganAt = glow.beganAt;
    env.advance(3000);
    env.watch(property, false);
    assert.equal(env.pending.size, 0, property);
    assert.equal(glow.strength(), 0, property);
    assert.equal(glow.drift, false, property);
    if (property === 'exposed') assert.equal(glow.motionDuration(), 0);
    env.elapse(motion.quietAfter);
    env.watch(property, true);
    assert.equal(glow.beganAt, beganAt);
    assert.equal(glow.quiet, true);
    assert.equal(glow.drift, false);
    assert.equal(env.pending.size, 0, 'returning from the background does not restart the ten-second window');
  }
});

test('disappearance clears the pending timeout and even a late callback cannot mutate the unmounted instance', () => {
  const env = environment();
  const { glow } = env;
  glow.busy = true;
  env.mount();
  const timeout = env.scheduled.at(-1);
  glow.aboutToDisappear();
  assert.equal(env.pending.size, 0);
  assert.equal(glow.quietTimer, -1);
  const previous = [glow.quiet, glow.drift];
  timeout.callback();
  assert.deepEqual([glow.quiet, glow.drift], previous);
  env.watch('busy', false);
  assert.equal(env.pending.size, 0, 'property notifications after unmount schedule nothing');
});

test('finishing clears the deadline and a late timeout cannot restore ended top illumination', () => {
  const env = environment('top');
  const { glow } = env;
  glow.busy = true;
  glow.illuminated = true;
  env.mount();
  const timeout = env.scheduled.at(-1);
  env.watch('illuminated', false);
  env.watch('busy', false);
  assert.equal(env.pending.size, 0);
  assert.equal(glow.strength(), 0);
  timeout.callback();
  assert.equal(glow.strength(), 0);
  assert.equal(glow.drift, false);
  assert.equal(env.pending.size, 0);
});

test('a queued timeout from the previous send cannot quiet a new send or discard its timer handle', () => {
  for (const placement of ['composer', 'top']) {
    const env = environment(placement);
    const { glow, motion } = env;
    glow.busy = true;
    glow.illuminated = true;
    env.mount();
    const oldTimeout = env.scheduled.at(-1);
    env.advance(3000);
    env.watch('busy', false);
    env.watch('illuminated', false);
    env.watch('busy', true);
    env.watch('illuminated', true);
    const currentTimeout = env.scheduled.at(-1);
    const currentStrength = glow.strength();
    const currentStart = glow.beganAt;
    assert.notEqual(currentTimeout.id, oldTimeout.id);
    // Model a previously queued callback being delivered after cancellation,
    // while the newer send still has three seconds before its own deadline.
    env.elapse(oldTimeout.at - env.now);
    oldTimeout.callback();
    assert.equal(glow.quiet, false, placement);
    assert.equal(glow.drift, true, placement);
    assert.equal(glow.strength(), currentStrength, placement);
    assert.equal(glow.beganAt, currentStart, placement);
    assert.equal(glow.quietTimer, currentTimeout.id, placement + ' retains the current cancellation handle');
    assert.equal(env.pending.size, 1);
    assert.equal(env.pending.has(currentTimeout.id), true);
    env.advance(currentStart + motion.quietAfter - env.now - 1);
    assert.equal(glow.quiet, false);
    env.advance(1);
    assert.equal(glow.quiet, true);
    assert.equal(glow.drift, false);
    assert.equal(glow.quietTimer, -1);
    assert.equal(env.pending.size, 0);
  }
});

test('a subsequent send schedules no timer for an unilluminated top layer', () => {
  const env = environment('top');
  const { glow } = env;
  glow.busy = true;
  glow.illuminated = true;
  env.mount();
  env.watch('illuminated', false);
  env.watch('busy', false);
  const timerCount = env.scheduled.length;
  env.watch('busy', true);
  assert.equal(glow.strength(), 0);
  assert.equal(glow.drift, false);
  assert.equal(env.pending.size, 0);
  assert.equal(env.scheduled.length, timerCount);
});

test('Watch ordering starts age at the busy transition and later visibility or motion changes cannot reset it', () => {
  for (const order of [['busy', 'illuminated'], ['illuminated', 'busy']]) {
    const env = environment('top');
    const { glow, motion } = env;
    env.mount();
    const initial = env.now;
    env.watch(order[0], true);
    env.elapse(250);
    env.watch(order[1], true);
    const expectedStart = initial + (order[0] === 'busy' ? 0 : 250);
    assert.equal(glow.beganAt, expectedStart, order.join(' → '));
    assert.equal([...env.pending.values()][0].at, expectedStart + motion.quietAfter);
    env.elapse(1000);
    env.watch('reducedMotion', true);
    env.elapse(1000);
    env.watch('reducedMotion', false);
    assert.equal(glow.beganAt, expectedStart);
    assert.equal(env.pending.size, 1);
    assert.equal([...env.pending.values()][0].at, expectedStart + motion.quietAfter);
    env.advance(expectedStart + motion.quietAfter - env.now);
    assert.equal(glow.quiet, true);
    assert.equal(env.pending.size, 0);
  }
});

test('ending a quiet top glow cannot brighten it regardless of busy/illumination Watch order', () => {
  for (const order of [['busy', 'illuminated'], ['illuminated', 'busy']]) {
    const env = environment('top');
    const { glow, motion } = env;
    glow.busy = true;
    glow.illuminated = true;
    env.mount();
    env.advance(motion.quietAfter);
    const quietStrength = glow.strength();
    for (const property of order) {
      env.watch(property, false);
      assert.ok(glow.strength() <= quietStrength, property + ' changed first must not increase top intensity');
    }
    assert.equal(glow.strength(), 0);
    assert.equal(env.pending.size, 0);
  }
});
