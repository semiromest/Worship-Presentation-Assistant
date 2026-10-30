import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatestPreviewQueue } from './previewQueue';

test('rapid generations retain only the latest pending task, including after an active failure', async () => {
  const ran: number[] = [], errors: unknown[] = [];
  const queue = new LatestPreviewQueue(error => errors.push(error));
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  queue.schedule(async () => { await waiting; ran.push(0); throw new Error('failed lane'); });
  for (let i = 1; i <= 10_000; i++) queue.schedule(async () => { ran.push(i); });
  assert.equal(queue.activeCount, 1); assert.equal(queue.pendingCount, 1);
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(ran, [0, 10_000]); assert.equal(errors.length, 1);
  assert.equal(queue.activeCount, 0); assert.equal(queue.pendingCount, 0);
});

test('A resumes after transient raw B is cancelled before the throttle changes', async () => {
  const queue = new LatestPreviewQueue(error => { throw error; });
  const published: string[] = [];
  let finish!: () => void, cancelledA = false;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const cancelA = queue.schedule(async () => { await waiting; if (!cancelledA) published.push('obsolete-A'); });
  cancelledA = true; cancelA();
  const cancelB = queue.schedule(async () => { published.push('obsolete-B'); });
  cancelB(); // Undo returns to exactly the same A snapshot before B is rendered.
  queue.schedule(async () => { published.push('resumed-A'); });
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(published, ['resumed-A']);
  assert.equal(queue.activeCount, 0); assert.equal(queue.pendingCount, 0);
});
