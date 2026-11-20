import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import type { ToNdiWorker, FromNdiWorker } from './ndiProtocol';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// Execute the actual worker module with a controlled native boundary and deterministic timers.
// This covers startup/stop races without requiring an installed NDI runtime or network receiver.
function harness() {
  let now = 0, closed = false, destroyed = false;
  let receive!: (message: ToNdiWorker) => void;
  const messages: FromNdiWorker[] = [];
  const timers = new Set<() => void>();
  const videos: any[] = [], audios: any[] = [], options: any[] = [];
  const sender = {
    video: (frame: any): Promise<void> => { videos.push(frame); return Promise.resolve(); },
    audio: (frame: any): Promise<void> => { audios.push(frame); return Promise.resolve(); },
    connections: () => 0, tally: () => ({}), sourceName: () => 'test',
    destroy: () => { destroyed = true; return true; },
  };
  const grandi = {
    send: async (opts: any) => { options.push(opts); return sender; },
    FourCC: { BGRA: 1, FLTp: 2 }, FrameType: { Progressive: 1 }, version: () => 'test',
  };
  const cache = new Map<string, any>();
  const load = (filename: string): any => {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports, Buffer, performance: { now: () => now },
      setInterval: (fn: () => void) => { timers.add(fn); return fn; },
      clearInterval: (fn: () => void) => timers.delete(fn),
      require: (id: string) => {
        if (id === 'grandi') return grandi;
        if (id === 'node:worker_threads') return { parentPort: {
          on: (_: string, fn: typeof receive) => { receive = fn; },
          postMessage: (message: FromNdiWorker) => messages.push(message),
          close: () => { closed = true; },
        } };
        return load(path.resolve(path.dirname(filename), `${id}.ts`));
      },
    }, { filename });
    return exports;
  };
  load(path.join(__dirname, 'ndiWorker.ts'));
  return {
    sender, grandi, messages, videos, audios, options,
    send: (message: ToNdiWorker) => receive(message),
    start: async (fps = 30) => { receive({ type: 'start', name: 'test', fps, audio: true, straightAlpha: false }); await flush(); },
    tick: async (at: number) => { now = at; for (const fn of timers) fn(); await flush(); },
    get closed() { return closed; }, get destroyed() { return destroyed; },
    get timerCount() { return timers.size; },
  };
}

test('slow native audio and video are bounded and stop waits for both before destroying', async () => {
  const h = harness();
  const audio = deferred(), video = deferred();
  h.sender.audio = frame => { h.audios.push(frame); return audio.promise; };
  h.sender.video = frame => { h.videos.push(frame); return video.promise; };
  await h.start();
  assert.equal(h.options[0].clockAudio, false);
  h.send({ type: 'frame', data: new ArrayBuffer(16), width: 2, height: 2, stride: 8 });
  assert.ok(h.messages.some(m => m.type === 'frame-accepted'));
  await h.tick(110);
  for (let i = 0; i < 20; i++) await h.tick(150 + i * 33);
  assert.equal(h.audios.length, 1);
  assert.equal(h.videos.length, 1);
  h.send({ type: 'stop' });
  await flush();
  assert.equal(h.timerCount, 0);
  assert.equal(h.destroyed, false);
  video.resolve(); await flush();
  assert.equal(h.destroyed, false);
  audio.resolve(); await flush();
  assert.equal(h.destroyed, true);
  assert.equal(h.closed, true);
});

test('stop during native sender creation destroys the eventual sender without starting timers', async () => {
  const h = harness(), gate = deferred();
  h.grandi.send = async () => { await gate.promise; return h.sender; };
  await h.start();
  h.send({ type: 'stop' });
  gate.resolve(); await flush();
  assert.equal(h.destroyed, true);
  assert.equal(h.closed, true);
  assert.equal(h.timerCount, 0);
  assert.equal(h.messages.some(m => m.type === 'started'), false);
});

test('a synchronous native send failure is reported and the next tick can recover', async () => {
  const h = harness();
  await h.start();
  h.sender.video = () => { throw new Error('native send failed'); };
  h.send({ type: 'frame', data: new ArrayBuffer(16), width: 2, height: 2, stride: 8 });
  await h.tick(110);
  assert.ok(h.messages.some(m => m.type === 'error' && m.message === 'native send failed' && !m.fatal));
  h.sender.video = async frame => { h.videos.push(frame); };
  await h.tick(150);
  assert.equal(h.videos.length, 1);
  h.send({ type: 'stop' }); await flush();
});

test('malformed frames are acknowledged but never reach native code', async () => {
  const h = harness();
  await h.start();
  for (const width of [NaN, 0, -1, 1.5, 3]) {
    h.send({ type: 'frame', data: new ArrayBuffer(16), width, height: 2, stride: 8 });
  }
  h.send({ type: 'audio', source: 'music', data: new ArrayBuffer(7) });
  await h.tick(110);
  assert.equal(h.messages.filter(m => m.type === 'frame-accepted').length, 5);
  assert.equal(h.videos.length, 0);
  h.send({ type: 'stop' }); await flush();
});

test('continuous paints at the highest supported rate do not starve delayed video', async () => {
  const h = harness();
  await h.start(120);
  for (let i = 0; i < 120; i++) {
    h.send({ type: 'frame', data: new ArrayBuffer(16), width: 2, height: 2, stride: 8 });
    await h.tick((i + 1) * 1000 / 120);
  }
  assert.ok(h.videos.length >= 100, 'video continues after the initial 100 ms delay');
  h.send({ type: 'stop' }); await flush();
});
