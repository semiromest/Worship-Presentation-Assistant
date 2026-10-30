import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewPriority, encodePreview, takeNextPreview, runPreviewWorkers } from './previewEncoding';
test('preview order prioritizes live/neighbors/visible and produces every index once', () => {
  assert.deepEqual(previewPriority(6, 3, [5, 1, 5]), [3, 2, 4, 5, 1, 0]);
  assert.deepEqual(previewPriority(0, -1, []), []);
});
test('null blobs reject instead of leaving the queue pending', async () => {
  await assert.rejects(encodePreview({ toBlob: (callback: BlobCallback) => callback(null) } as HTMLCanvasElement), /no data/);
});
test('asynchronous read errors and synchronous reader failures reject and release listeners', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  try {
    for (const mode of ['event', 'throw']) {
      let reader: { onload: unknown; onerror: (() => void) | null; onabort: unknown };
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: class {
        onload = null; onerror = null; onabort = null;
        constructor() { reader = this; }
        readAsDataURL() { if (mode === 'throw') throw new Error('Reader failed'); queueMicrotask(() => reader.onerror?.()); }
      } });
      await assert.rejects(encodePreview({ toBlob: (callback: BlobCallback) => queueMicrotask(() => callback(new Blob(['preview']))) } as HTMLCanvasElement), /failed/i);
      assert.equal(reader!.onload, null); assert.equal(reader!.onerror, null); assert.equal(reader!.onabort, null);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'FileReader', original);
    else Reflect.deleteProperty(globalThis, 'FileReader');
  }
});
test('navigation reprioritizes pending work without losing completed jobs', () => {
  const remaining = new Set([0, 1, 2, 3, 4, 5]);
  assert.equal(takeNextPreview(remaining, 0, [3]), 0);
  assert.equal(takeNextPreview(remaining, 5, [3]), 5);
  assert.equal(takeNextPreview(remaining, 5, [3]), 4);
  assert.equal(takeNextPreview(remaining, 5, [3]), 3);
  assert.deepEqual([...remaining], [1, 2]);
});
test('one failed lane cannot release the generation barrier while another lane is running', async () => {
  let finish!: () => void, lanes = 0, settled = false;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const run = runPreviewWorkers(2, async () => { if (lanes++ === 0) throw new Error('encode failed'); await waiting; });
  const observed = run.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false);
  finish(); await observed; await assert.rejects(run, /encode failed/);
});
