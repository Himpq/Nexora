/* Run with `node --test tools/test_glow_preferences.cjs`.
 * Executes production GlowPreferences, SoftGlowState, SystemBars and DesignTokens.
 * Only HarmonyOS platform facilities and the clock/timer scheduler are adapted.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

process.env.TZ = 'Asia/Shanghai';
const tsPath = process.env.NEXORA_TYPESCRIPT_PATH ||
  'C:/Program Files/Huawei/DevEco Studio/tools/hvigor/hvigor/node_modules/typescript/lib/typescript.js';
const ts = require(tsPath);
const sourceRoot = path.resolve(__dirname, '../entry/src/main/ets');
const productionPath = path.join(sourceRoot, 'theme/GlowPreferences.ets');
const compiled = new Map();
const colorMode = Object.freeze({ COLOR_MODE_DARK: 0, COLOR_MODE_LIGHT: 1, COLOR_MODE_NOT_SET: -1 });
const at = (day, hour, minute = 0, second = 0, ms = 0) => new Date(2026, 8, day, hour, minute, second, ms).getTime();

function transpile(filename) {
  if (!compiled.has(filename)) {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
      fileName: filename,
      reportDiagnostics: true,
    });
    assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0,
      'Production source must transpile: ' + filename);
    compiled.set(filename, result.outputText);
  }
  return compiled.get(filename);
}

function environment({ disk = new Map(), now = at(22, 10), systemDark = false, systemReduceMotion = false } = {}) {
  const clock = { now };
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length === 0 ? [clock.now] : args)); }
    static now() { return clock.now; }
  }
  const appStorage = new Map();
  const timers = new Map();
  const storedValues = new Map(disk);
  const pendingWrites = [];
  const preferenceNames = [];
  const bars = [];
  const motionCallbacks = new Set();
  const subscribedCallbacks = [];
  const unsubscribedCallbacks = [];
  const logs = [];
  let nextTimerId = 1;
  let maxTimers = 0;
  let reduceMotion = systemReduceMotion;
  let motionQueryFails = false;
  const context = { config: { colorMode: systemDark ? colorMode.COLOR_MODE_DARK : colorMode.COLOR_MODE_LIGHT } };
  const window = {
    setWindowSystemBarProperties(properties) {
      bars.push({ ...properties });
      return Promise.resolve();
    },
  };
  const preferences = {
    getPreferencesSync(_context, options) {
      preferenceNames.push(options.name);
      return {
        getSync(key, fallback) { return storedValues.has(key) ? storedValues.get(key) : fallback; },
        putSync(key, value) { storedValues.set(key, value); },
        flush() {
          const snapshot = new Map(storedValues);
          const operation = Promise.resolve().then(() => {
            for (const [key, value] of snapshot) disk.set(key, value);
          });
          pendingWrites.push(operation);
          return operation;
        },
      };
    },
  };
  const accessibility = {
    isAnimationReduceEnabledSync() {
      if (motionQueryFails) throw new Error('Fixture accessibility query failure');
      return reduceMotion;
    },
    onAnimationReduceStateChange(callback) {
      subscribedCallbacks.push(callback);
      motionCallbacks.add(callback);
    },
    offAnimationReduceStateChange(callback) {
      unsubscribedCallbacks.push(callback);
      motionCallbacks.delete(callback);
    },
  };
  const platform = {
    '@kit.AbilityKit': { ConfigurationConstant: { ColorMode: colorMode } },
    '@kit.ArkData': { preferences },
    '@kit.AccessibilityKit': { accessibility },
    '@kit.PerformanceAnalysisKit': { hilog: { warn: (...args) => logs.push(args) } },
    '@kit.ArkUI': {},
    '@kit.ArkTS': { url: { URL: { parseURL: input => new URL(input) } } },
  };
  const sandbox = vm.createContext({
    Date: FixtureDate,
    AppStorage: {
      get(key) { return appStorage.get(key); },
      setOrCreate(key, value) { appStorage.set(key, value); return true; },
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, due: clock.now + delay });
      maxTimers = Math.max(maxTimers, timers.size);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    assert.ok(filename.startsWith(sourceRoot + path.sep), 'Only production ArkTS modules may be loaded');
    const module = { exports: {} };
    modules.set(filename, module);
    const factory = vm.runInContext('(function(exports, require, module) {\n' + transpile(filename) + '\n})',
      sandbox, { filename });
    factory(module.exports, specifier => {
      if (Object.hasOwn(platform, specifier)) return platform[specifier];
      if (specifier.startsWith('.')) return load(path.resolve(path.dirname(filename), specifier + '.ets'));
      throw new Error('Unexpected runtime dependency: ' + specifier);
    }, module);
    return module.exports;
  }
  const production = load(productionPath);
  const palettes = load(path.join(sourceRoot, 'theme/DesignTokens.ets'));
  return {
    ...production,
    disk, context, timers, bars, window, preferenceNames, subscribedCallbacks, unsubscribedCallbacks,
    motionCallbacks, logs, palettes,
    service: production.sharedGlowPreferences,
    init() { production.sharedGlowPreferences.init(context); },
    get(key) { return appStorage.get(key); },
    set(key, value) { appStorage.set(key, value); },
    setNow(timestamp) { clock.now = timestamp; },
    nextDue() { return Math.min(...[...timers.values()].map(timer => timer.due)); },
    get maxTimers() { return maxTimers; },
    setSystemDark(dark) { context.config.colorMode = dark ? colorMode.COLOR_MODE_DARK : colorMode.COLOR_MODE_LIGHT; },
    emitReduceMotion(enabled) {
      reduceMotion = enabled;
      for (const callback of motionCallbacks) callback(enabled);
    },
    setMotionQueryFailure(fails) { motionQueryFails = fails; },
    advanceTo(timestamp) {
      assert.ok(timestamp >= clock.now, 'Fixture timer advancement must be monotonic');
      let callbacks = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > timestamp) break;
        assert.ok(++callbacks < 30, 'Unexpected timer loop');
        clock.now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      clock.now = timestamp;
    },
    async settle() { await Promise.all(pendingWrites); },
  };
}

test('first launch defaults to system appearance and automatic atmosphere; initialization is idempotent', () => {
  const env = environment();
  env.init();
  env.init();
  assert.deepEqual(env.preferenceNames, ['nx_glow_preferences']);
  assert.equal(env.get('nxAppearance'), 'system');
  assert.equal(env.get('nxGlowSchedule'), 'auto');
  assert.equal(env.get('nxGlowEnabled'), true);
  assert.equal(env.get('nxGlowReduceMotion'), false);
  assert.equal(env.get('nxAppForeground'), false);
  assert.equal(env.get('nxSystemReduceMotion'), false);
  assert.equal(env.timers.size, 0, 'Creation alone must not start a foreground timer');
  assert.equal(env.subscribedCallbacks.length, 1);
  assert.equal(env.motionCallbacks.size, 1);
});

for (const [hour, systemDark, expectedPeriod] of [
  [10, false, 'day'], [10, true, 'day'], [22, false, 'night'], [22, true, 'night'],
]) {
  test(expectedPeriod + ' atmosphere × ' + (systemDark ? 'dark' : 'light') + ' system appearance stays independent', () => {
    const env = environment({ now: at(22, hour), systemDark });
    env.init();
    assert.equal(env.get('nxDarkMode'), systemDark);
    assert.equal(env.get('nxGlowPeriod'), expectedPeriod);
    assert.equal(env.get('nxAppearance'), 'system');
    assert.equal(env.get('nxGlowSchedule'), 'auto');
  });
}

test('manual atmosphere changes never select a different page appearance', () => {
  const env = environment({ now: at(22, 10) });
  env.init();
  env.service.setAppearance('dark');
  env.service.setGlowSchedule('day');
  assert.equal(env.get('nxDarkMode'), true);
  assert.equal(env.get('nxGlowPeriod'), 'day');
  env.service.setAppearance('light');
  env.service.setGlowSchedule('night');
  assert.equal(env.get('nxDarkMode'), false);
  assert.equal(env.get('nxGlowPeriod'), 'night');
  env.service.setAppearance('time');
  assert.equal(env.get('nxDarkMode'), false, 'Daytime appearance must not use the manually selected night atmosphere');
  env.setNow(at(22, 22));
  env.service.setGlowSchedule('day');
  assert.equal(env.get('nxDarkMode'), true, 'Nighttime appearance must not use the manually selected day atmosphere');
  assert.equal(env.get('nxGlowPeriod'), 'day');
});

test('all four user preferences survive a fresh process and immediately reapply', async () => {
  const env = environment();
  env.init();
  env.service.setAppearance('dark');
  env.service.setGlowSchedule('day');
  env.service.setEnabled(false);
  env.service.setReduceMotion(true);
  await env.settle();
  assert.deepEqual(Object.fromEntries(env.disk), {
    nxAppearance: 'dark', nxGlowSchedule: 'day', nxGlowEnabled: false, nxGlowReduceMotion: true,
  });
  const restarted = environment({ disk: env.disk, now: at(22, 22), systemDark: false });
  restarted.init();
  assert.equal(restarted.get('nxAppearance'), 'dark');
  assert.equal(restarted.get('nxGlowSchedule'), 'day');
  assert.equal(restarted.get('nxGlowEnabled'), false);
  assert.equal(restarted.get('nxGlowReduceMotion'), true);
  assert.equal(restarted.get('nxDarkMode'), true);
  assert.equal(restarted.get('nxGlowPeriod'), 'day');
  assert.equal(restarted.get('nxAppForeground'), false, 'Visibility is process state, not a persisted preference');
});

test('corrupt persisted values use safe defaults instead of inventing an appearance', () => {
  const env = environment({ disk: new Map([
    ['nxAppearance', 'night'], ['nxGlowSchedule', 'light'], ['nxGlowEnabled', 'false'], ['nxGlowReduceMotion', 1],
  ]) });
  env.init();
  assert.equal(env.get('nxAppearance'), 'system');
  assert.equal(env.get('nxGlowSchedule'), 'auto');
  assert.equal(env.get('nxGlowEnabled'), true);
  assert.equal(env.get('nxGlowReduceMotion'), false);
});

test('system color updates affect only system appearance, preserving manual and time choices', () => {
  const env = environment({ now: at(22, 10) });
  env.init();
  env.service.setAppearance('dark');
  env.setSystemDark(false);
  env.service.refresh(false);
  assert.equal(env.get('nxDarkMode'), true);
  env.service.setAppearance('light');
  env.setSystemDark(true);
  env.service.refresh(true);
  assert.equal(env.get('nxDarkMode'), false);
  env.service.setAppearance('time');
  env.service.refresh(true);
  assert.equal(env.get('nxDarkMode'), false);
  env.setNow(at(22, 22));
  env.setSystemDark(false);
  env.service.refresh(false);
  assert.equal(env.get('nxDarkMode'), true);
  env.service.setAppearance('system');
  assert.equal(env.get('nxDarkMode'), false);
  env.setSystemDark(true);
  env.service.refresh(true);
  assert.equal(env.get('nxDarkMode'), true);
});

test('partial or unset system configurations never interpret undefined as light', () => {
  const env = environment({ systemDark: true });
  env.init();
  env.context.config.colorMode = undefined;
  env.service.refresh(undefined);
  assert.equal(env.get('nxDarkMode'), true);
  env.context.config.colorMode = colorMode.COLOR_MODE_NOT_SET;
  env.service.refresh();
  assert.equal(env.get('nxDarkMode'), true);
  env.setSystemDark(false);
  env.service.refresh(false);
  assert.equal(env.get('nxDarkMode'), false);
});

test('the single foreground timer switches both automatic policies at the exact local boundaries', () => {
  const env = environment({ now: at(22, 6, 59, 59, 999) });
  env.init();
  env.service.setAppearance('time');
  env.service.setForeground(true);
  assert.equal(env.get('nxDarkMode'), true);
  assert.equal(env.get('nxGlowPeriod'), 'night');
  assert.equal(env.timers.size, 1);
  assert.equal(env.nextDue(), at(22, 7));
  env.advanceTo(at(22, 7));
  assert.equal(env.get('nxDarkMode'), false);
  assert.equal(env.get('nxGlowPeriod'), 'day');
  assert.equal(env.nextDue(), at(22, 19));
  env.advanceTo(at(22, 18, 59, 59, 999));
  assert.equal(env.get('nxGlowPeriod'), 'day');
  env.advanceTo(at(22, 19));
  assert.equal(env.get('nxDarkMode'), true);
  assert.equal(env.get('nxGlowPeriod'), 'night');
  assert.equal(env.nextDue(), at(23, 7));
  assert.equal(env.timers.size, 1);
  assert.equal(env.maxTimers, 1);
});

test('repeated refresh, foreground and preference updates never accumulate timers', () => {
  const env = environment();
  env.init();
  env.service.setForeground(true);
  for (let i = 0; i < 10; i++) {
    env.service.refresh();
    env.service.setForeground(true);
    env.service.setAppearance('system');
    env.service.setGlowSchedule('auto');
    env.init();
  }
  assert.equal(env.timers.size, 1);
  assert.equal(env.maxTimers, 1);
  assert.equal(env.nextDue(), at(22, 19));
  assert.equal(env.subscribedCallbacks.length, 1);
  assert.equal(env.preferenceNames.length, 1);
});

test('background cancels the timer and a late callback cannot rearm it; foreground catches up', () => {
  const env = environment({ now: at(22, 18) });
  env.init();
  env.service.setForeground(true);
  const callbackAlreadyQueued = [...env.timers.values()][0].callback;
  env.service.setForeground(false);
  assert.equal(env.get('nxAppForeground'), false);
  assert.equal(env.timers.size, 0);
  env.advanceTo(at(22, 23));
  callbackAlreadyQueued();
  assert.equal(env.timers.size, 0);
  assert.equal(env.get('nxGlowPeriod'), 'day', 'No background timer should have fired');
  env.service.refresh();
  assert.equal(env.timers.size, 0, 'A background configuration refresh must not schedule work');
  env.setSystemDark(true);
  env.service.setForeground(true);
  assert.equal(env.get('nxAppForeground'), true);
  assert.equal(env.get('nxGlowPeriod'), 'night');
  assert.equal(env.get('nxDarkMode'), true);
  assert.equal(env.nextDue(), at(23, 7));
  assert.equal(env.maxTimers, 1);
});

test('system reduce-motion initial state and callbacks stay independent of the saved user preference', () => {
  const env = environment({ systemReduceMotion: true });
  env.init();
  assert.equal(env.get('nxSystemReduceMotion'), true);
  assert.equal(env.get('nxGlowReduceMotion'), false);
  env.service.setReduceMotion(false);
  assert.equal(env.get('nxSystemReduceMotion'), true, 'An app preference cannot turn off a system accessibility choice');
  env.emitReduceMotion(false);
  assert.equal(env.get('nxSystemReduceMotion'), false);
  env.service.setReduceMotion(true);
  env.emitReduceMotion(true);
  env.emitReduceMotion(false);
  assert.equal(env.get('nxGlowReduceMotion'), true, 'A system callback cannot overwrite the user preference');
  assert.equal(env.get('nxSystemReduceMotion'), false);
});

test('a canceled callback delivered after returning to foreground cannot orphan the replacement timer', () => {
  const env = environment({ now: at(22, 18) });
  env.init();
  env.service.setForeground(true);
  const callbackAlreadyQueued = [...env.timers.values()][0].callback;
  env.service.setForeground(false);
  env.setNow(at(22, 20));
  env.service.setForeground(true);
  assert.equal(env.timers.size, 1);
  callbackAlreadyQueued();
  assert.equal(env.timers.size, 1, 'A stale callback must not lose the live timer handle');
  assert.equal(env.nextDue(), at(23, 7));
  assert.equal(env.maxTimers, 1);
  env.service.setForeground(false);
  assert.equal(env.timers.size, 0, 'All scheduled work must still be cancelable');
});

test('failed accessibility queries preserve the last known reduced-motion state', () => {
  const env = environment();
  env.init();
  env.emitReduceMotion(true);
  env.setMotionQueryFailure(true);
  assert.doesNotThrow(() => env.service.refresh());
  assert.equal(env.get('nxSystemReduceMotion'), true);
  env.setMotionQueryFailure(false);
  env.emitReduceMotion(false);
  env.service.refresh();
  assert.equal(env.get('nxSystemReduceMotion'), false);
});

test('dispose cancels timers, removes the exact callback and supports a clean later initialization', async () => {
  const env = environment();
  env.init();
  env.service.setAppearance('dark');
  env.service.setForeground(true);
  const callback = env.subscribedCallbacks[0];
  await env.settle();
  env.service.dispose();
  env.service.dispose();
  assert.equal(env.timers.size, 0);
  assert.equal(env.get('nxAppForeground'), false);
  assert.equal(env.motionCallbacks.size, 0);
  assert.deepEqual(env.unsubscribedCallbacks, [callback]);
  env.emitReduceMotion(true);
  assert.equal(env.get('nxSystemReduceMotion'), false, 'The destroyed instance must receive no callbacks');
  env.init();
  assert.equal(env.motionCallbacks.size, 1);
  assert.equal(env.subscribedCallbacks.length, 2);
  assert.equal(env.subscribedCallbacks[1], callback, 'The production module keeps a stable named callback');
  assert.equal(env.get('nxSystemReduceMotion'), true);
  assert.equal(env.get('nxAppearance'), 'dark');
  assert.equal(env.timers.size, 0);
});

test('manual appearance immediately updates real system-bar properties while reader immersion owns its bars', () => {
  const env = environment();
  env.init();
  env.service.attachWindow(env.window);
  env.service.setAppearance('dark');
  assert.equal(env.bars.at(-1).statusBarColor, env.palettes.NxDarkPalette.pageBg);
  assert.equal(env.bars.at(-1).navigationBarContentColor, env.palettes.NxDarkPalette.text1);
  const beforeReader = env.bars.length;
  env.set('nxReaderImmersive', true);
  env.service.setAppearance('light');
  env.service.setGlowSchedule('night');
  env.service.refresh(true);
  assert.equal(env.get('nxDarkMode'), false, 'App preferences still update independently of reader appearance');
  assert.equal(env.bars.length, beforeReader, 'No bar writes while the reader owns its immersive appearance');
  env.set('nxReaderImmersive', false);
  env.service.refresh();
  assert.equal(env.bars.at(-1).statusBarColor, env.palettes.NxLightPalette.pageBg);
  assert.equal(env.bars.at(-1).navigationBarContentColor, env.palettes.NxLightPalette.text1);
  const beforeDetach = env.bars.length;
  env.service.attachWindow(undefined);
  env.service.setAppearance('dark');
  assert.equal(env.bars.length, beforeDetach, 'No window means no system-bar write');
});
