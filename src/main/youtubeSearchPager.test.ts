import assert from 'node:assert/strict';
import { test } from 'node:test';
import { YouTubeSearchPager, type YouTubeSearchPage } from './youtubeSearchPager';
import type { YouTubeSearchResponse } from '../shared/youtubeMusic';

const videos = (start: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: String(start + index).padStart(11, '0'),
    title: `Video ${start + index}`,
    duration: 60,
  }));
function success(response: YouTubeSearchResponse) {
  assert.equal(response.ok, true);
  return response;
}

test('first search returns 12 without fetching continuations; later pages retain overflow and deduplicate IDs', async () => {
  let fetches = 0;
  const pager = new YouTubeSearchPager(async () => ({
    results: videos(0, 30),
    next: async () => {
      fetches++;
      return { results: videos(28, 10) };
    },
  }));
  const first = success(await pager.search('music'));
  assert.equal(first.results.length, 12);
  assert.equal(fetches, 0);
  const second = success(await pager.search('music', first.nextCursor));
  assert.equal(second.results.length, 12);
  assert.equal(fetches, 0);
  const third = success(await pager.search('music', second.nextCursor));
  assert.equal(third.results.length, 12);
  assert.equal(fetches, 1);
  const fourth = success(await pager.search('music', third.nextCursor));
  assert.equal(fourth.results.length, 2);
  assert.equal(fourth.nextCursor, undefined);
  assert.deepEqual([...first.results, ...second.results, ...third.results, ...fourth.results], videos(0, 38));
});

test('failed continuation preserves pending items and allows retry', async () => {
  let fail = true;
  const pager = new YouTubeSearchPager(async () => ({
    results: videos(0, 15),
    next: async () => {
      if (fail) throw new Error('offline');
      return { results: videos(15, 10) };
    },
  }));
  const first = success(await pager.search('music'));
  assert.deepEqual(await pager.search('music', first.nextCursor), { ok: false, error: 'search-failed' });
  fail = false;
  const second = success(await pager.search('music', first.nextCursor));
  assert.deepEqual(second.results, videos(12, 12));
});

test('invalid, expired and query-mismatched cursors do not fetch provider pages', async () => {
  let now = 0,
    loads = 0;
  const pager = new YouTubeSearchPager(
    async () => {
      loads++;
      return { results: videos(0, 20) };
    },
    () => now
  );
  assert.equal((await pager.search(null)).ok, false);
  const first = success(await pager.search('music'));
  assert.deepEqual(await pager.search('different', first.nextCursor), { ok: false, error: 'search-expired' });
  assert.deepEqual(await pager.search('music', {}), { ok: false, error: 'search-expired' });
  now = 10 * 60 * 1000;
  assert.deepEqual(await pager.search('music', first.nextCursor), { ok: false, error: 'search-expired' });
  assert.equal(loads, 1);
});

test('keeps at most eight searches and clear invalidates pending initial requests', async () => {
  const pager = new YouTubeSearchPager(async () => ({ results: videos(0, 20) }));
  const first = success(await pager.search('first'));
  for (let index = 0; index < 8; index++) success(await pager.search(`query ${index}`));
  assert.deepEqual(await pager.search('first', first.nextCursor), { ok: false, error: 'search-expired' });
  let resolve!: (value: YouTubeSearchPage) => void;
  const pendingPager = new YouTubeSearchPager(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = pendingPager.search('pending');
  pendingPager.clear();
  resolve({ results: videos(0, 20) });
  assert.deepEqual(await pending, { ok: false, error: 'unavailable' });
});

test('simultaneous continuation requests cannot consume the same page twice', async () => {
  let resolve!: (value: YouTubeSearchPage) => void;
  const pager = new YouTubeSearchPager(async () => ({
    results: videos(0, 12),
    next: () =>
      new Promise((done) => {
        resolve = done;
      }),
  }));
  const first = success(await pager.search('music'));
  const pending = pager.search('music', first.nextCursor);
  assert.deepEqual(await pager.search('music', first.nextCursor), { ok: false, error: 'search-busy' });
  resolve({ results: videos(12, 12) });
  assert.deepEqual(success(await pending).results, videos(12, 12));
});

test('a short initial page does not trigger extra requests, and malformed provider results are ignored', async () => {
  let calls = 0;
  const pager = new YouTubeSearchPager(async () => ({
    results: [...videos(0, 2), { id: 'bad', title: 'Invalid ID', duration: 0 }],
    next: async () => {
      calls++;
      return { results: videos(2, 2) };
    },
  }));
  const first = success(await pager.search('music'));
  assert.equal(first.results.length, 2);
  assert.equal(calls, 0);
  assert.deepEqual(success(await pager.search('music', first.nextCursor)).results, videos(2, 2));
});
