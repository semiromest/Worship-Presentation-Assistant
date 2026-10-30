import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosterQueue } from './mediaPosterQueue';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('visible work displaces speculative jobs at a hard waiting limit and runs first', async () => {
  const calls: string[] = [], finish: Array<() => void> = [];
  const queue = createPosterQueue(source => new Promise(resolve => { calls.push(source); finish.push(() => resolve(source)); }), 1, { maxWaiting: 2 });
  const active = queue.request('active', () => true);
  const far = queue.request('far', () => true, 3);
  const near = queue.request('near', () => true, 2);
  const visible = queue.request('visible', () => true, 0);
  assert.equal(await far, null);
  assert.equal(queue.snapshot().waiting, 2);
  await tick(); finish.shift()!(); await active; await tick();
  assert.deepEqual(calls, ['active', 'visible']);
  finish.shift()!(); await visible; await tick(); finish.shift()!(); await near;
});

test('obsolete work is discarded before admission, and live QoS lowers active concurrency', async () => {
  let capacity = 1, mounted = true;
  const finish: Array<() => void> = [], calls: string[] = [];
  const queue = createPosterQueue(source => new Promise(resolve => { calls.push(source); finish.push(() => resolve(source)); }), () => capacity, { maxWaiting: 1 });
  const first = queue.request('first', () => true);
  const old = queue.request('old', () => mounted);
  mounted = false; capacity = 2;
  const next = queue.request('next', () => true);
  assert.equal(await old, null);
  await tick(); assert.deepEqual(calls, ['first', 'next']);
  finish.forEach(resolve => resolve()); await Promise.all([first, next]);
});

test('completed results use LRU entry and byte limits without evicting in-flight requests', async () => {
  const calls: string[] = [];
  const queue = createPosterQueue(async source => { calls.push(source); return source; }, 2, { maxEntries: 2 });
  await queue.request('a', () => true);
  await queue.request('b', () => true);
  await queue.request('a', () => true); // a becomes most recently used
  await queue.request('c', () => true);
  await queue.request('a', () => true);
  assert.deepEqual(calls, ['a', 'b', 'c']);
  await queue.request('b', () => true);
  assert.deepEqual(calls, ['a', 'b', 'c', 'b']);

  let finish!: (value: string) => void;
  let loads = 0;
  const bounded = createPosterQueue(() => { loads++; return new Promise(resolve => { finish = resolve; }); }, 1, { maxBytes: 4 });
  const pending = bounded.request('large', () => true);
  await tick();
  assert.equal(bounded.request('large', () => true), pending);
  finish('data:image/png;base64,large'); await pending; await tick();
  const again = bounded.request('large', () => true);
  await tick(); assert.equal(loads, 2);
  finish('large'); await again;
});

test('failed entries expire only for future requests and can still be explicitly retried', async () => {
  let now = 0, calls = 0;
  const queue = createPosterQueue(async () => { calls++; return null; }, 2, { now: () => now, failureTtlMs: 10 });
  await queue.request('bad', () => true);
  now = 9; await queue.request('bad', () => true); assert.equal(calls, 1);
  now = 10; await queue.request('bad', () => true); assert.equal(calls, 2);
  queue.invalidate('bad'); await queue.request('bad', () => true); assert.equal(calls, 3);
});

test('a hidden invalidated queued request cannot remove its visible replacement', async () => {
  let finish!: () => void;
  const queue = createPosterQueue(source => source === 'busy'
    ? new Promise(resolve => { finish = () => resolve('busy'); }) : Promise.resolve(source), 1);
  const busy = queue.request('busy', () => true);
  const old = queue.request('same', () => false);
  queue.invalidate('same');
  const replacement = queue.request('same', () => true);
  await tick(); finish(); await busy; await old;
  assert.equal(await replacement, 'same');
  assert.equal(queue.request('same', () => true), replacement);
});

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
