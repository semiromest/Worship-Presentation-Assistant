/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS benchmark. */
// Run: node scripts/media-thumbnails-bench.cjs <source.ts> <phase> <fixture-directory>
// Exercises the real thumbnail module and real FFmpeg; Electron only supplies an isolated userData path.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { transformSync } = require('esbuild');
const { createRequire } = require('node:module');
const [source, phase, fixtures] = process.argv.slice(2);
if (!fixtures) throw new Error('source, phase and fixture-directory are required');
const baseRequire = createRequire(path.resolve('src/main/mediaThumbnails.ts'));
const run = (bin, args) =>
  new Promise((resolve, reject) =>
    cp.execFile(bin, args, { windowsHide: true, timeout: 60000 }, (err) => (err ? reject(err) : resolve()))
  );
async function main() {
  await fs.mkdir(fixtures, { recursive: true });
  for (const [name, size] of [
    ['1080p', '1920x1080'],
    ['4k', '3840x2160'],
  ]) {
    const target = path.join(fixtures, name + '.mp4');
    try {
      await fs.access(target);
    } catch {
      await run('ffmpeg', [
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${size}:rate=10`,
        '-t',
        '2',
        '-c:v',
        'mpeg4',
        '-q:v',
        '5',
        '-y',
        target,
      ]);
    }
  }
  const code = transformSync(await fs.readFile(source, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const results = [];
  for (const resolution of ['1080p', '4k'])
    for (const count of [1, 10, 50]) {
      const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'presenter-thumb-bench-'));
      const sources = [];
      for (let i = 0; i < count; i++) {
        const target = path.join(userData, `video-${i}.mp4`);
        await fs.copyFile(path.join(fixtures, resolution + '.mp4'), target);
        sources.push(target);
      }
      let calls = { discover: 0, probe: 0, extract: 0, sync: 0, maxChildren: 0 },
        active = 0;
      const classify = (args) =>
        args.includes('-version') ? 'discover' : args.includes('-show_entries') ? 'probe' : 'extract';
      const load = () => {
        const module = { exports: {} };
        const hooked = {
          ...cp,
          execFile(bin, args, opts, callback) {
            calls[classify(args)]++;
            active++;
            calls.maxChildren = Math.max(calls.maxChildren, active);
            return cp.execFile(bin, args, opts, (...values) => {
              active--;
              callback(...values);
            });
          },
          spawnSync(bin, args, opts) {
            calls.sync++;
            calls[classify(args)]++;
            return cp.spawnSync(bin, args, opts);
          },
        };
        const req = (id) =>
          id === 'electron'
            ? { app: { getPath: () => userData } }
            : id === 'node:child_process'
              ? hooked
              : baseRequire(id);
        new Function('require', 'module', 'exports', code)(req, module, module.exports);
        return module.exports;
      };
      let api = load();
      for (const temperature of ['cold', 'warm', 'reopen']) {
        if (temperature === 'reopen') api = load();
        calls = { discover: 0, probe: 0, extract: 0, sync: 0, maxChildren: 0 };
        let maxLag = 0,
          previous = performance.now();
        const interval = setInterval(() => {
          const now = performance.now();
          maxLag = Math.max(maxLag, now - previous - 10);
          previous = now;
        }, 10);
        const started = performance.now();
        const values = await Promise.all(sources.map((file) => api.getOrCreateThumbnail(file)));
        await new Promise((resolve) => setTimeout(resolve, 20));
        clearInterval(interval);
        results.push({
          resolution,
          count,
          temperature,
          ms: Math.round(performance.now() - started - 20),
          maxEventLoopLagMs: Math.round(Math.max(0, maxLag)),
          success: values.filter(Boolean).length,
          ...calls,
        });
      }
      await fs.rm(userData, { recursive: true, force: true });
    }
  const output = { phase, platform: process.platform, cpu: os.cpus()[0]?.model, results };
  await fs.writeFile(path.join(fixtures, phase + '.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
