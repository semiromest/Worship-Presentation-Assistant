import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosterQueue } from './mediaPosterQueue';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('poster queue bounds work, deduplicates sources and caches success/failure', async () => {
  let active = 0;
  let maxActive = 0;
  const jobs: Array<() => void> = [];
  const calls: string[] = [];
  const queue = createPosterQueue(source => new Promise(resolve => {
    calls.push(source); active++; maxActive = Math.max(maxActive, active);
    jobs.push(() => { active--; resolve(source === 'bad' ? null : source); });
  }));
  const a = queue.request('a', () => true);
  assert.equal(queue.request('a', () => true), a);
  const b = queue.request('b', () => true);
  const bad = queue.request('bad', () => true);
  await tick();
  assert.deepEqual(calls, ['a', 'b']);
  jobs.shift()!(); await tick();
  assert.deepEqual(calls, ['a', 'b', 'bad']);
  jobs.shift()!(); jobs.shift()!();
  assert.deepEqual(await Promise.all([a, b, bad]), ['a', 'b', null]);
  assert.equal(maxActive, 2);
  assert.equal(await queue.request('bad', () => true), null);
  assert.equal(calls.length, 3);
  queue.invalidate('bad');
  const retry = queue.request('bad', () => true);
  await tick(); jobs.shift()!(); await retry;
  assert.equal(calls.length, 4);
});

test('hidden subscribers cancel queued jobs but retain other visible subscribers', async () => {
  let finish!: () => void;
  const calls: string[] = [];
  const queue = createPosterQueue(source => {
    calls.push(source);
    if (source === 'busy') return new Promise(resolve => { finish = () => resolve('busy'); });
    return Promise.resolve(source);
  }, 1);
  const busy = queue.request('busy', () => true);
  let firstVisible = true;
  const shared = queue.request('shared', () => firstVisible);
  assert.equal(shared, queue.request('shared', () => true));
  const hidden = queue.request('hidden', () => false);
  firstVisible = false;
  await tick(); finish(); await busy;
  assert.equal(await shared, 'shared');
  assert.equal(await hidden, null);
  assert.deepEqual(calls, ['busy', 'shared']);
  assert.equal(await queue.request('hidden', () => true), 'hidden');
});
