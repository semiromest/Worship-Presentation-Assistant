import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGoogleFont, retryUnavailableFonts } from './fontLoader';

test('unavailable fonts do not repeat downloads for every slide; explicit retry is immediate', async () => {
  let requests = 0;
  Object.assign(globalThis, { window: { electronAPI: { cacheGoogleFont: async () => { requests++; return null; } } } });
  assert.equal(await loadGoogleFont('Unavailable Test Font'), false);
  await Promise.all(Array.from({ length: 100 }, () => loadGoogleFont('Unavailable Test Font')));
  assert.equal(requests, 1);
  retryUnavailableFonts();
  assert.equal(await loadGoogleFont('Unavailable Test Font'), false);
  assert.equal(requests, 2);
});
