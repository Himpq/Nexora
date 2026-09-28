/* Run with `node --test tools/test_soft_glow_state.cjs`.
 * Transpiles and executes the production ArkTS module; only platform URL and
 * Preferences are adapted to Node. Each environment models one app process.
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
const filename = path.resolve(__dirname, '../entry/src/main/ets/services/SoftGlowState.ets');
const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  fileName: filename,
  reportDiagnostics: true,
});
assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);

function environment(disk = new Map()) {
  const memory = new Map(disk);
  const preferencesNames = [];
  let initFails = false;
  let getFails = false;
  let putFails = false;
  let flushFails = false;
  let flushThrows = false;
  let flushGate = null;
  let reads = 0;
  let writes = 0;
  let flushes = 0;
  const pending = [];
  const store = {
    getSync(key, fallback) {
      reads++;
      if (getFails) throw new Error('fixture read failure');
      return memory.has(key) ? memory.get(key) : fallback;
    },
    putSync(key, value) {
      writes++;
      if (putFails) throw new Error('fixture write failure');
      memory.set(key, value);
    },
    flush() {
      flushes++;
      if (flushThrows) throw new Error('fixture flush start failure');
      const snapshot = new Map(memory);
      const operation = (async () => {
        if (flushGate) await flushGate;
        if (flushFails) throw new Error('fixture flush failure');
        for (const [key, value] of snapshot) disk.set(key, value);
      })();
      pending.push(operation);
      return operation;
    },
  };
  const exported = {};
  vm.runInNewContext(result.outputText, {
    exports: exported,
    require(specifier) {
      if (specifier === '@kit.ArkTS') return { url: { URL: { parseURL: input => new URL(input) } } };
      if (specifier === '@kit.ArkData') return {
        preferences: {
          getPreferencesSync(_context, options) {
            preferencesNames.push(options.name);
            if (initFails) throw new Error('fixture initialization failure');
            return store;
          },
        },
      };
      throw new Error('Unexpected runtime dependency: ' + specifier);
    },
  }, { filename });
  return {
    ...exported,
    disk,
    memory,
    preferencesNames,
    state: exported.sharedSoftGlowState,
    init() { exported.sharedSoftGlowState.init({}); },
    setInitFailure(value) { initFails = value; },
    setReadFailure(value) { getFails = value; },
    setWriteFailure(value) { putFails = value; },
    setFlushFailure(value) { flushFails = value; },
    setFlushThrow(value) { flushThrows = value; },
    setFlushGate(value) { flushGate = value; },
    get reads() { return reads; },
    get writes() { return writes; },
    get flushes() { return flushes; },
    async settle() { await Promise.allSettled(pending); },
  };
}

const at = (day, hour, minute = 0, second = 0, ms = 0) => new Date(2026, 8, day, hour, minute, second, ms).getTime();
const account = 'glow_reader';
const service = 'https://glow.example.invalid';

test('day and night use one exact local 07:00–19:00 boundary', () => {
  const env = environment();
  for (const [timestamp, expected] of [
    [at(21, 0), 'night'], [at(21, 6, 59, 59, 999), 'night'],
    [at(21, 7), 'day'], [at(21, 18, 59, 59, 999), 'day'],
    [at(21, 19), 'night'], [at(21, 23, 59, 59, 999), 'night'],
  ]) assert.equal(env.nxGlowPeriodAt(timestamp), expected);
  assert.equal(env.nxGlowDayAt(Date.parse('2026-09-21T16:00:00Z')), '2026-09-22');
  assert.equal(env.nxGlowPeriodAt(Date.parse('2026-09-20T23:00:00Z')), 'day');
});

test('the next boundary is strictly later and retains the local hour across DST', () => {
  const env = environment();
  assert.equal(env.nxNextGlowBoundaryAt(at(21, 6, 59, 59, 999)), at(21, 7));
  assert.equal(env.nxNextGlowBoundaryAt(at(21, 7)), at(21, 19));
  assert.equal(env.nxNextGlowBoundaryAt(at(21, 19)), at(22, 7));
  assert.ok(Number.isNaN(env.nxNextGlowBoundaryAt(NaN)));
  const previousZone = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const spring = new Date(2026, 2, 7, 19).getTime();
    const fall = new Date(2026, 9, 31, 19).getTime();
    assert.equal(env.nxNextGlowBoundaryAt(spring), new Date(2026, 2, 8, 7).getTime());
    assert.equal(env.nxNextGlowBoundaryAt(spring) - spring, 11 * 60 * 60 * 1000);
    assert.equal(env.nxNextGlowBoundaryAt(fall), new Date(2026, 10, 1, 7).getTime());
    assert.equal(env.nxNextGlowBoundaryAt(fall) - fall, 13 * 60 * 60 * 1000);
  } finally {
    process.env.TZ = previousZone;
  }
});

test('claim is synchronous, once per day, and persists across a process restart', async () => {
  const env = environment();
  env.init();
  env.init();
  assert.deepEqual(env.preferencesNames, ['nx_soft_glow_state_v1']);
  let release;
  env.setFlushGate(new Promise(resolve => { release = resolve; }));
  assert.equal(env.state.claimFirstGlow(account, service, at(21, 8)), true);
  assert.equal(env.disk.size, 0, 'claim does not await disk or block input');
  assert.equal(env.state.claimFirstGlow(account, service, at(21, 8)), false);
  assert.equal(env.state.claimFirstGlow(account, service, at(21, 20)), false, 'night is still the same natural day');
  assert.equal(env.writes, 1);
  release();
  await env.settle();
  const restarted = environment(env.disk);
  restarted.init();
  assert.equal(restarted.state.claimFirstGlow(account, service, at(21, 23)), false);
  assert.equal(restarted.state.claimFirstGlow(account, service, at(22, 0)), true);
  await restarted.settle();
});

test('the request timestamp stays on its original day across midnight; each day is retained', async () => {
  const env = environment();
  env.init();
  const submittedAt = at(21, 23, 59, 59);
  assert.equal(env.state.claimFirstGlow(account, service, submittedAt), true);
  assert.equal(env.state.claimFirstGlow(account, service, submittedAt), false, 'same request cannot claim again');
  assert.equal(env.state.claimFirstGlow(account, service, at(22, 0)), true, 'new day permits a new send');
  assert.equal(env.state.claimFirstGlow(account, service, submittedAt), false, 'a stale callback cannot roll the day back');
  await env.settle();
  const restarted = environment(env.disk);
  restarted.init();
  assert.equal(restarted.state.claimFirstGlow(account, service, submittedAt), false);
  assert.equal(restarted.state.claimFirstGlow(account, service, at(22, 0)), false);
});

test('account, service, and installation are independent and cannot consume each other', async () => {
  const env = environment();
  env.init();
  const timestamp = at(21, 8);
  assert.equal(env.state.claimFirstGlow(account, service, timestamp), true);
  assert.equal(env.state.claimFirstGlow('other_reader', service, timestamp), true);
  assert.equal(env.state.claimFirstGlow(account, 'https://other.example.invalid', timestamp), true);
  assert.equal(env.state.claimFirstGlow(account, service, timestamp), false);
  const otherInstall = environment();
  otherInstall.init();
  assert.equal(otherInstall.state.claimFirstGlow(account, service, timestamp), true);
  await env.settle();
  await otherInstall.settle();
  assert.equal(env.disk.size, 3);
  assert.equal(otherInstall.disk.size, 1);
});

test('normalization shares equivalent base URLs without conflating different environments', () => {
  const env = environment();
  env.init();
  const timestamp = at(21, 8);
  assert.equal(env.state.claimFirstGlow(' ' + account + ' ', ' HTTPS://GLOW.EXAMPLE.INVALID:443/api/// ', timestamp), true);
  assert.equal(env.state.claimFirstGlow(account, service + '/api', timestamp), false);
  assert.equal(env.state.claimFirstGlow(account, service + '/api#unused-fragment', timestamp), false);
  assert.equal(env.state.claimFirstGlow(account, 'http://GLOW.EXAMPLE.INVALID:80/', timestamp), true);
  assert.equal(env.state.claimFirstGlow(account, 'http://glow.example.invalid', timestamp), false);
  assert.equal(env.state.claimFirstGlow(account, service + ':8443/api', timestamp), true);
  assert.equal(env.state.claimFirstGlow(account, service + '/API', timestamp), true);
  assert.equal(env.state.claimFirstGlow(account, service + '/api?tenant=two', timestamp), true);
  assert.equal(env.state.claimFirstGlow(account.toUpperCase(), service + '/api', timestamp), true);
});

test('missing identity, malformed services and invalid timestamps do not read or consume state', () => {
  const env = environment();
  env.init();
  const timestamp = at(21, 8);
  for (const [user, base, time] of [
    ['', service, timestamp], ['  ', service, timestamp], [account, '', timestamp],
    [account, 'not a URL', timestamp], [account, 'ftp://glow.example.invalid', timestamp],
    [account, 'https://user:password@glow.example.invalid', timestamp],
    [account, service, NaN], [account, service, Infinity],
    [account, service, 1e30], ['x'.repeat(1025), service, timestamp],
    ['\uD800', service, timestamp],
  ]) assert.equal(env.state.claimFirstGlow(user, base, time), false);
  assert.equal(env.reads, 0);
  assert.equal(env.writes, 0);
  assert.equal(env.state.claimFirstGlow(account, service, timestamp), true);
});

test('unavailable storage skips the decoration without spending the first claim', () => {
  const env = environment();
  const timestamp = at(21, 8);
  assert.equal(env.state.claimFirstGlow(account, service, timestamp), false);
  env.setInitFailure(true);
  assert.doesNotThrow(() => env.init());
  assert.equal(env.state.claimFirstGlow(account, service, timestamp), false);
  env.setInitFailure(false);
  env.init();
  env.setReadFailure(true);
  assert.equal(env.state.claimFirstGlow(account, service, timestamp), false);
  assert.equal(env.writes, 0);
  env.setReadFailure(false);
  assert.equal(env.state.claimFirstGlow(account, service, timestamp), true);
});

for (const failure of ['write', 'flush', 'flush start']) {
  test(failure + ' failure cannot reject input or replay an already presented glow in the session', async () => {
    const env = environment();
    env.init();
    if (failure === 'write') env.setWriteFailure(true);
    else if (failure === 'flush') env.setFlushFailure(true);
    else env.setFlushThrow(true);
    assert.equal(env.state.claimFirstGlow(account, service, at(21, 8)), true);
    await env.settle();
    assert.equal(env.state.claimFirstGlow(account, service, at(21, 9)), false);
    assert.equal(env.writes, 1);
    assert.equal(env.disk.size, 0);
  });
}

test('pure state accepts an injected storage adapter and safely encodes separators', () => {
  const env = environment();
  const values = new Map();
  const state = new env.SoftGlowState({
    get: key => values.get(key) || '',
    put: (key, value) => values.set(key, value),
    flush: async () => {},
  });
  assert.equal(state.claimFirstGlow('reader|one', service, at(21, 8)), true);
  assert.equal(state.claimFirstGlow('reader%7Cone', service, at(21, 8)), true);
  assert.equal(state.claimFirstGlow('reader|one', service, at(21, 8)), false);
  assert.equal(values.size, 2);
});
