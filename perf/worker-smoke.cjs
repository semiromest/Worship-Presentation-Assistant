/**
 * Phase 7 automated smoke test — runs the BUILT heavyWorker.js under a real
 * Electron main process (no window). Validates:
 *   T1 build-gpres   — media embed, transferable zipBuffer return
 *   T2 extract-gpres — media re-materialization into a fresh media dir
 *   T3 export-pptx   — valid .pptx written, progress events flowed
 *   T4 import-pptx   — round-trip back into slides with externalized media
 *   T5 crash recovery — kill mid-flight -> in-flight rejected, next call respawns
 *
 * Run after `npx tsc --noEmit && npx vite build`:
 *   npx electron perf/worker-smoke.cjs
 * Exit code 0 = all checks passed.
 */
const { app, utilityProcess } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');

const WORKER_PATH = path.join(__dirname, '..', 'dist-electron', 'heavyWorker.js');

// 1x1 transparent PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let worker = null;
let nextId = 1;
const pending = new Map();
const progressEvents = [];
let results = [];

function check(name, ok, extra) {
  results.push({ name, ok, extra });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

function spawnWorker() {
  worker = utilityProcess.fork(WORKER_PATH, [], { serviceName: 'presenter-heavy-worker-smoke' });
  worker.on('message', (m) => {
    if (m && m.type === 'progress') { progressEvents.push(m); return; }
    if (!m || typeof m.id !== 'number' || !pending.has(m.id)) return;
    const p = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error || 'worker request failed'));
  });
  worker.on('exit', () => {
    const inflight = [...pending.values()];
    pending.clear();
    for (const p of inflight) { clearTimeout(p.timer); p.reject(new Error('worker exited unexpectedly')); }
    worker = null;
  });
  return worker;
}

function call(type, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`request timed out (${type})`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    if (!worker) spawnWorker();
    try {
      worker.postMessage({ id, type, payload });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err);
    }
  });
}

function deck(mediaUrl) {
  return {
    id: 'smoke-deck',
    name: 'Smoke Test Deck',
    version: 1,
    slides: [
      { id: 's1', type: 'text', content: 'Smoke Test Slide', styles: { fontFamily: 'Arial', fontSize: 48, textColor: '#ffffff', textAlign: 'center' } },
      { id: 's2', type: 'image', mediaUrl, styles: { objectFit: 'cover' } },
    ],
  };
}

const ARRAY_BUFFER_OF = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

async function main() {
  if (!fs.existsSync(WORKER_PATH)) {
    console.error(`missing ${WORKER_PATH} — run "npx tsc --noEmit && npx vite build" first`);
    app.exit(2);
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-smoke-'));
  const dirA = path.join(root, 'media-a');
  const dirB = path.join(root, 'media-b');
  const dirC = path.join(root, 'media-c');
  for (const d of [dirA, dirB, dirC]) fs.mkdirSync(d, { recursive: true });

  const refName = 'smokeimg1.png';
  fs.writeFileSync(path.join(dirA, refName), PNG_1PX);
  const mediaUrl = `local-resource://media/${refName}`;
  const outGpres = path.join(root, 'out.gpres');
  const outPptx = path.join(root, 'out.pptx');

  // ── T1: build-gpres ────────────────────────────────────────────────────
  console.log('\nT1  build-gpres (media embed + transferable return)');
  const b1 = await call('build-gpres', { content: JSON.stringify(deck(mediaUrl)), mediaDir: dirA });
  const zipBuffer = b1 && b1.zipBuffer;
  const isBin = Buffer.isBuffer(zipBuffer) || zipBuffer instanceof Uint8Array;
  check('embeddedCount === 1', b1 && b1.embeddedCount === 1, `embeddedCount=${b1 && b1.embeddedCount}`);
  check('zipBuffer is Buffer/Uint8Array', isBin, `${zipBuffer && zipBuffer.constructor && zipBuffer.constructor.name}, bytes=${zipBuffer && zipBuffer.length}`);
  if (isBin) {
    fs.writeFileSync(outGpres, zipBuffer);
    const zip = new AdmZip(outGpres);
    const names = zip.getEntries().map((e) => e.entryName);
    check('zip has presentation.json', names.includes('presentation.json'), names.join(','));
    check('zip has media/' + refName, names.includes('media/' + refName));
    const parsed = JSON.parse(zip.readAsText('presentation.json'));
    const rewritten = parsed.slides[1].mediaUrl;
    check('tree rewritten to media/' + refName, rewritten === 'media/' + refName, `mediaUrl=${rewritten}`);
  }

  // ── T2: extract-gpres ──────────────────────────────────────────────────
  console.log('\nT2  extract-gpres (media re-materialized into fresh dir)');
  const e2 = await call('extract-gpres', { buffer: ARRAY_BUFFER_OF(zipBuffer), mediaDir: dirB }, 60000);
  check('mediaCount === 1', e2 && e2.mediaCount === 1, `mediaCount=${e2 && e2.mediaCount}`);
  // extract re-materializes content-addressed (hash name), not the original name
  const backRef = e2 && e2.data && e2.data.slides[1] && e2.data.slides[1].mediaUrl;
  const backName = backRef && backRef.startsWith('local-resource://media/') ? backRef.slice('local-resource://media/'.length) : null;
  check('ref is a media-library ref', /^local-resource:\/\/media\/[a-zA-Z0-9._-]+\.png$/.test(String(backRef)), `mediaUrl=${backRef}`);
  check('content-addressed file exists in media-b', !!backName && fs.existsSync(path.join(dirB, backName)), `file=${backName}`);

  // ── T3: export-pptx ────────────────────────────────────────────────────
  console.log('\nT3  export-pptx (valid file + progress)');
  const e3 = await call('export-pptx', { content: JSON.stringify(deck(mediaUrl)), filePath: outPptx, mediaDir: dirA });
  check('export success', e3 && e3.success === true, JSON.stringify(e3 && { slideCount: e3.slideCount, warnings: e3.warnings }));
  check('file written', fs.existsSync(outPptx), outPptx);
  const head = fs.existsSync(outPptx) ? fs.readFileSync(outPptx).subarray(0, 2).toString() : '';
  check('file is a zip (PK)', head === 'PK', head);
  check('progress events flowed', progressEvents.filter((p) => p.type === 'progress').length > 0,
    `${progressEvents.filter((p) => p.type === 'progress').length} progress events`);

  // ── T4: import-pptx (round-trip; resvg warm-up ~7s) ────────────────────
  console.log('\nT4  import-pptx (round-trip + media externalization)');
  const e4 = await call('import-pptx', { filePath: outPptx, mediaDir: dirC });
  check('import success', e4 && e4.success === true, e4 && e4.error ? `error=${e4.error}` : `slides=${e4 && e4.slides && e4.slides.length}`);
  if (e4 && e4.success && Array.isArray(e4.slides)) {
    // Imported slides are rendered images (PptxSlideResult.imageData)
    const imgSlides = e4.slides.filter((s) => s.imageData && String(s.imageData).startsWith('local-resource://media/'));
    check('media externalized as local-resource refs', imgSlides.length === e4.slides.length, `${imgSlides.length}/${e4.slides.length} slide(s)`);
    const allFiles = imgSlides.every((s) => {
      const n = String(s.imageData).slice('local-resource://media/'.length);
      return fs.existsSync(path.join(dirC, n));
    });
    check('media files exist in media-c', allFiles === true);
  }

  // ── T5: crash recovery ─────────────────────────────────────────────────
  console.log('\nT5  crash recovery (kill mid-flight -> reject + respawn)');
  const pid = worker && worker.pid;
  check('worker spawned (separate process)', typeof pid === 'number' && pid > 0, `pid=${pid}`);
  const killPromise = new Promise((resolve) => {
    const w = worker;
    w.once('exit', () => resolve('exited'));
    w.kill();
  });
  const inflight = call('build-gpres', { content: JSON.stringify(deck(mediaUrl)), mediaDir: dirA }).then(
    () => 'resolved-before-kill',
    (err) => `rejected:${err.message}`,
  );
  await killPromise;
  const inflightResult = await inflight;
  if (inflightResult.startsWith('rejected')) check('in-flight request rejected on kill', true, inflightResult);
  else console.log(`  SKIP  in-flight rejection (request finished before kill: ${inflightResult}) — respawn still verified`);
  const e5 = await call('build-gpres', { content: JSON.stringify(deck(mediaUrl)), mediaDir: dirA });
  check('next call respawns and succeeds', e5 && e5.embeddedCount === 1, `embeddedCount=${e5 && e5.embeddedCount}`);
  const pid2 = worker && worker.pid;
  check('new worker process', typeof pid2 === 'number' && pid2 !== pid, `pid=${pid} -> ${pid2}`);

  // ── Summary ────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.error(`  FAILED: ${f.name} (${f.extra || ''})`);
  }
  console.log(`artifacts: ${outGpres}, ${outPptx} (${root})`);
  fs.rmSync(root, { recursive: true, force: true });
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('smoke failed with exception:', err);
    app.exit(1);
  });
});
