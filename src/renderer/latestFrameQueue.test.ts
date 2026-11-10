import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatestFrameQueue } from './latestFrameQueue';
test('invalidated work cannot publish; only the latest successor runs', async () => {
  let release!: () => void; const started: number[] = [], published: number[] = [];
  const queue = new LatestFrameQueue<number>(async (value, valid) => {
    started.push(value); if (value === 1) await new Promise<void>(resolve => { release = resolve; });
    if (valid()) published.push(value);
  });
  queue.request(1); queue.invalidate(); queue.request(2); queue.request(3); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [1, 3]); assert.deepEqual(published, [3]); queue.close(); queue.request(4);
  assert.deepEqual(started, [1, 3]);
});
test('failed work does not wedge the queue', async () => {
  let errors = 0, complete = 0;
  const queue = new LatestFrameQueue<number>(async n => { if (n === 1) throw Error(); complete++; }, () => errors++);
  queue.request(1); queue.request(2); await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors, 1); assert.equal(complete, 1); queue.close();
});
