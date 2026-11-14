import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMusicStream } from './musicStreamFetch';

test('stream is not aborted by a total 20-second song deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.fetch;
  let signal!: AbortSignal;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  globalThis.fetch = async (_input, init) => {
    signal = init!.signal!;
    return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }, { highWaterMark: 0 }));
  };
  try {
    const response = await fetchMusicStream('https://fixture.invalid/audio');
    const reader = response.body!.getReader();
    for (let index = 0; index < 3; index++) {
      const read = reader.read();
      await Promise.resolve();
      t.mock.timers.tick(15000);
      assert.equal(signal.aborted, false);
      controller.enqueue(Uint8Array.of(index));
      assert.deepEqual((await read).value, Uint8Array.of(index));
    }
    controller.close();
    assert.equal((await reader.read()).done, true);
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});

test('cancelling an audio response cancels its source request', async () => {
  const original = globalThis.fetch;
  let signal!: AbortSignal;
  let cancelled = false;
  globalThis.fetch = async (_input, init) => {
    signal = init!.signal!;
    return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }));
  };
  try {
    const response = await fetchMusicStream('https://fixture.invalid/audio');
    await response.body!.cancel();
    assert.equal(signal.aborted, true);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = original; }
});

test('paced fetch waits only after a response that brought no new media', async () => {
  const { pacedMusicFetch, SABR_PROGRESS_BYTES } = await import('./musicStreamFetch');
  const sizes = [SABR_PROGRESS_BYTES * 4, 10, SABR_PROGRESS_BYTES];
  const waits: number[] = [];
  let call = 0;
  const fetcher = (async () => new Response(new Uint8Array(sizes[call++] ?? 0))) as typeof fetch;
  const paced = pacedMusicFetch(fetcher, 200, async ms => { waits.push(call); void ms; });
  for (let index = 0; index < 4; index++) await (await paced('https://fixture.invalid/sabr')).arrayBuffer();
  // 1st: no wait. 2nd: previous was large → no wait. 3rd: previous was tiny → wait. 4th: previous was large → no wait.
  assert.deepEqual(waits, [2]);
});
