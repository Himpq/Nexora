// Local visual QA only: sample actual emulator frames; this is not an FPS measurement.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const hdc = 'C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe';
const device = '127.0.0.1:5555';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function checkedCommandOutput(result, label) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  // hdc can report a device-side failure in stdout while returning exit code 0.
  if (result.error || result.status !== 0 || /(?:^|\n)\s*(?:error:|\[Fail\]|\[E\]|failed\b)/i.test(output)) {
    throw new Error(`${label} failed (exit ${result.status}):\n${output || result.error?.message || 'No command output'}`);
  }
  return output;
}

function runHdc(args, label) {
  return checkedCommandOutput(spawnSync(hdc, ['-t', device, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, windowsHide: true
  }), label);
}

function validatePng(file) {
  if (!fs.existsSync(file)) throw new Error(`Screenshot was not transferred: ${file}`);
  const data = fs.readFileSync(file);
  if (data.length < 45 || !data.subarray(0, 8).equals(pngSignature) ||
      data.toString('ascii', 12, 16) !== 'IHDR' ||
      data.readUInt32BE(16) !== 628 || data.readUInt32BE(20) !== 1380 ||
      data.toString('ascii', data.length - 8, data.length - 4) !== 'IEND') {
    throw new Error(`Screenshot is not a complete 628x1380 PNG: ${file}`);
  }
  return { width: 628, height: 1380, bytes: data.length };
}

async function capture(name, seconds) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('invalid capture name');
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('capture duration must be positive');
  const duration = seconds * 1000;
  const dir = path.join(__dirname, name);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new Error(`Capture directory is not empty; use a new name: ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const remote = `/data/local/tmp/nexora-glow-${name}-${process.pid}.png`;
  const began = performance.now();
  const frames = [];
  while (performance.now() - began < duration) {
    const file = `frame-${String(frames.length).padStart(4, '0')}.png`;
    const localFile = path.join(dir, file);
    const before = performance.now();
    const snapshotOutput = runHdc(['shell', 'snapshot_display', '-f', remote, '-w', '628', '-h', '1380', '-t', 'png'], 'snapshot_display');
    const captured = performance.now();
    const transferOutput = runHdc(['file', 'recv', remote, localFile], 'hdc file recv');
    try {
      validatePng(localFile);
    } catch (error) {
      throw new Error(`${error.message}\nSnapshot output:\n${snapshotOutput}\nTransfer output:\n${transferOutput}`);
    }
    // Only a successfully transferred and validated image can become evidence.
    frames.push({ file, seconds: (captured - began) / 1000 });
    await sleep(Math.max(0, 250 - (performance.now() - before)));
  }
  if (frames.length === 0) throw new Error('No screenshots were captured');
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(frames, null, 2));
  const concat = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    concat.push(`file '${frames[i].file}'`);
    concat.push(`duration ${i + 1 < frames.length ? (frames[i + 1].seconds - frames[i].seconds).toFixed(3) : '0.250'}`);
  }
  concat.push(`file '${frames.at(-1).file}'`);
  fs.writeFileSync(path.join(dir, 'frames.ffconcat'), concat.join('\n'));
  runHdc(['shell', 'rm', '-f', remote], 'cleanup own capture file');
  console.log(JSON.stringify({ name, frames: frames.length, seconds: frames.at(-1).seconds, format: 'PNG', width: 628, height: 1380, finalHoldSeconds: 0.250 }));
}

module.exports = { capture, checkedCommandOutput, validatePng };
if (require.main === module) {
  capture(process.argv[2] || 'day-first', Number(process.argv[3] || 35))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
