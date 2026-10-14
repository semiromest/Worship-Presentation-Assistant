/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness isolates Electron dependencies. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { transformSync } = require('esbuild');
const source = path.join(__dirname, 'mediaThumbnails.ts');
const compiled = transformSync(syncFs.readFileSync(source, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const baseRequire = createRequire(source);
async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'presenter-thumbnail-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const apiModule = { exports: {} };
  const req = (id) => {
    if (id === 'electron') return { app: { getPath: () => dir } };
    if (id === 'ffmpeg-static') throw new Error('optional dependency absent');
    if (id === 'node:child_process')
      return {
        execFile(bin, args, opts, done) {
          calls.push({ bin, args, opts });
          assert.equal(opts.windowsHide, true);
          setImmediate(() => {
            if (args.includes('-version'))
              return done(options.missing ? Object.assign(new Error('missing'), { code: 'ENOENT' }) : null, 'version');
            if (args.includes('-show_entries')) return done(null, '2');
            const output = args.at(-1);
            syncFs.writeFileSync(output, Buffer.from('frame'));
            if (options.hold) return options.hold(() => done(null, ''));
            done(options.fail ? Object.assign(new Error('killed'), { killed: true }) : null, '');
          });
        },
        spawnSync() {
          throw new Error('synchronous discovery forbidden');
        },
      };
    return baseRequire(id);
  };
  new Function('require', 'module', 'exports', compiled)(req, apiModule, apiModule.exports);
  const video = path.join(dir, 'video.mp4');
  await fs.writeFile(video, 'source');
  const cache = async (file) => {
    const st = await fs.stat(file);
    return crypto.createHash('sha1').update(`${file}:${st.size}:${st.mtimeMs}:400`).digest('hex').slice(0, 20);
  };
  const frames = () => calls.filter((c) => c.args.includes('-vframes'));
  return { dir, api: apiModule.exports, video, cache, calls, frames };
}
test('existing JPEG cache is reused including a fresh module session', async (t) => {
  const x = await setup(t);
  const key = await x.cache(x.video);
  await fs.mkdir(path.join(x.dir, 'thumbnails'));
  await fs.writeFile(path.join(x.dir, 'thumbnails', key + '.jpg'), 'jpeg');
  assert.equal(await x.api.getOrCreateThumbnail(x.video), 'local-resource://thumbs/' + key + '.jpg');
  assert.equal(x.calls.length, 0);
});
test('concurrent requests share extraction; changed source creates a new key', async (t) => {
  const x = await setup(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => x.api.getOrCreateThumbnail(x.video)));
  assert.equal(new Set(results).size, 1);
  assert.ok(results[0]);
  assert.equal(x.frames().length, 1);
  await fs.appendFile(x.video, 'changed');
  assert.notEqual(await x.api.getOrCreateThumbnail(x.video), results[0]);
  assert.equal(x.frames().length, 2);
  assert.equal(x.calls.filter((c) => c.args.includes('-version')).length, 1);
  assert.deepEqual(
    (await fs.readdir(path.join(x.dir, 'thumbnails'))).filter((n) => n.startsWith('vthumb-') || n.endsWith('.tmp')),
    []
  );
});
test('missing FFmpeg discovery is cached without blocking and publishes no thumbnail', async (t) => {
  const x = await setup(t, { missing: true });
  assert.equal(await x.api.getOrCreateThumbnail(x.video), null);
  assert.equal(await x.api.getOrCreateThumbnail(x.video), null);
  assert.equal(x.calls.length, process.platform === 'win32' ? 2 : 1);
  assert.equal(x.frames().length, 0);
  assert.deepEqual(await fs.readdir(path.join(x.dir, 'thumbnails')), []);
});
test('failed or timed-out extraction cleans partial output and remains retryable', async (t) => {
  const x = await setup(t, { fail: true });
  assert.equal(await x.api.getOrCreateThumbnail(x.video), null);
  assert.equal(x.frames().length, 2);
  assert.deepEqual(await fs.readdir(path.join(x.dir, 'thumbnails')), []);
  assert.equal(await x.api.getOrCreateThumbnail(x.video), null);
  assert.equal(x.frames().length, 4);
  assert.deepEqual(await fs.readdir(path.join(x.dir, 'thumbnails')), []);
});
test('queued jobs recheck disk and concurrent outputs have unique temporary names', async (t) => {
  const held = [];
  const x = await setup(t, { hold: (finish) => held.push(finish) });
  const count = Math.max(2, Math.min(6, os.cpus().length || 4));
  const files = [];
  for (let i = 0; i < count + 1; i++) {
    const p = path.join(x.dir, `source-${i}.mp4`);
    await fs.writeFile(p, 'source');
    files.push(p);
  }
  const first = files.slice(0, count).map((p) => x.api.getOrCreateThumbnail(p));
  while (held.length < count) await new Promise((resolve) => setImmediate(resolve));
  const last = x.api.getOrCreateThumbnail(files.at(-1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const key = await x.cache(files.at(-1));
  await fs.writeFile(path.join(x.dir, 'thumbnails', key + '.jpg'), 'external cache');
  held.forEach((finish) => finish());
  await Promise.all(first);
  assert.equal(await last, 'local-resource://thumbs/' + key + '.jpg');
  assert.equal(x.frames().length, count);
  assert.equal(new Set(x.frames().map((c) => c.args.at(-1))).size, count);
});
