import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OfflineMusicCache, type DownloadAudio } from './offlineMusicCache';
const id = 'KI33ItOO_M4';
const other = 'SIfMHRHdTAI';
function audio(bytes = 32, finished = true): DownloadAudio {
  return { audio: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }), mimeType: 'audio/webm; codecs="opus"', finished: () => finished, abort() {} };
}
test('complete files persist across service restart without network and invalid paths never reach the loader', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-music-'));
  try {
    let calls = 0;
    const cache = new OfflineMusicCache(directory, async () => { calls++; return audio(); });
    assert.equal((await cache.status(id)).state, 'missing');
    assert.equal((await cache.download('../../bad')).state, 'error');assert.equal(calls, 0);
    const results = await Promise.all([cache.download(id), cache.download(id)]);
    assert.deepEqual(results, [{ state: 'ready' }, { state: 'ready' }]);assert.equal(calls, 1);
    const persisted = new OfflineMusicCache(directory, async () => { throw Error('network must not be used'); });
    assert.deepEqual(await persisted.download(id), { state: 'ready' });
    const file = await persisted.file(id);assert.ok(file);assert.equal((await fs.stat(file)).size, 32);
    await fs.truncate(file, 8);assert.equal(await persisted.file(id), null);
    await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify({ version: 1, extension: '../secret', bytes: 32 }));
    assert.equal(await persisted.file(id), null);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('partial, empty, oversized and failed streams cannot become offline-ready', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-music-'));
  try {
    for (const [size, finished] of [[32, false], [0, true], [64, true]] as const) {
      const cache = new OfflineMusicCache(directory, async () => audio(size, finished), 48);
      assert.equal((await cache.download(id)).state, 'error');assert.equal(await cache.file(id), null);
      assert.deepEqual(await fs.readdir(directory), []);
    }
    const cache = new OfflineMusicCache(directory, async () => { throw Error('offline'); });
    assert.equal((await cache.download(id)).state, 'error');assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('cancel and shutdown stop only downloads, deduplicate requests and clear partial files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-music-'));
  try {
    let starts = 0, aborts = 0;
    let started!: () => void;
    let began = new Promise<void>(r => { started = r; });
    const cache = new OfflineMusicCache(directory, async () => {
      starts++;started();
      return { audio: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(32)); } }), mimeType: 'audio/webm', finished: () => false, abort() { aborts++; } };
    });
    const pending = cache.download(id);await began;
    assert.deepEqual(await cache.status(id), { state: 'downloading' });
    assert.deepEqual(await cache.download(other), { state: 'error', error: 'busy' });
    cache.cancel(id);assert.deepEqual(await pending, { state: 'error', error: 'cancelled' });
    assert.equal(await cache.file(id), null);assert.deepEqual(await fs.readdir(directory), []);
    began = new Promise<void>(r => { started = r; });
    const again = cache.download(id);await began;cache.dispose();
    assert.deepEqual(await again, { state: 'error', error: 'cancelled' });
    assert.equal(starts, 2);assert.ok(aborts >= 2);assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('cancel during source initialization finishes promptly and disposes a late source', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-music-'));
  try {
    let release!: (value: DownloadAudio) => void, began!: () => void, aborted = 0;
    const started = new Promise<void>(resolve => { began = resolve; });
    const cache = new OfflineMusicCache(directory, () => { began();return new Promise(resolve => { release = resolve; }); });
    const job = cache.download(id);await started;cache.cancel(id);
    assert.deepEqual(await job, { state: 'error', error: 'cancelled' });
    assert.deepEqual(await cache.status(id), { state: 'missing' });
    release({ ...audio(), abort() { aborted++; } });
    await new Promise(resolve => setImmediate(resolve));assert.equal(aborted, 1);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('disposed instance cleanup cannot remove a replacement instance download', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-music-'));
  try {
    let release!: (value: DownloadAudio) => void, began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    const old = new OfflineMusicCache(directory, () => { began();return new Promise(resolve => { release = resolve; }); });
    const job = old.download(id);await started;old.dispose();
    const replacement = new OfflineMusicCache(directory, async () => audio());
    assert.deepEqual(await replacement.download(id), { state: 'ready' });
    release(audio());await job;await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await replacement.status(id), { state: 'ready' });
    assert.ok(await replacement.file(id));
    assert.ok((await fs.readdir(directory)).every(name => !name.endsWith('.part')));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
