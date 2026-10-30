import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Slide } from './types';
import { previewCacheMatches, prunePreviewCache, previewSourceGuard, type PreviewCacheEntry } from './previewCache';

test('A→partial B→A never reuses the B image, including an undo to the original A reference', () => {
  const a = { id: 'same', type: 'text', content: 'A', styles: { fontSize: 48 } } as Slide;
  const b = { ...a, content: 'B' };
  const watermark = {};
  const entry: PreviewCacheEntry = { url: 'image-B', slide: b, watermark, fontEpoch: 1 };
  assert.equal(previewCacheMatches(entry, a, watermark, 1), false);
  assert.equal(previewCacheMatches(entry, b, watermark, 1), true);
  assert.equal(previewCacheMatches(entry, b, {}, 1), false);
  assert.equal(previewCacheMatches(entry, b, watermark, 2), false);
  assert.equal(previewCacheMatches(entry, { ...b, partsMode: true, parts: ['new part'] }, watermark, 1), false);
});

test('closing a deck removes orphaned cache and retry entries from partial generations', () => {
  const slide = { id: 'partial-only', type: 'text', content: 'B' } as Slide;
  const cache = new Map<string, PreviewCacheEntry>([[slide.id, { url: 'B', slide, watermark: null, fontEpoch: 0 }]]);
  const retries = new Set(['partial-only', 'retry-only']);
  prunePreviewCache(cache, retries, new Set());
  assert.equal(cache.size, 0); assert.equal(retries.size, 0);
});
test('a delayed encode cannot publish after raw source changes ahead of its throttle', async () => {
  const b = { slides: [{ id: 'same', type: 'text', content: 'B' } as Slide], watermark: {}, fontEpoch: 1 };
  let current = b;
  const isCurrent = previewSourceGuard(b, () => current);
  assert.equal(isCurrent(), true);
  let finish!: () => void, published = false;
  const encoding = new Promise<void>(resolve => { finish = resolve; });
  const work = encoding.then(() => { if (isCurrent()) published = true; });
  current = { ...b, slides: [{ ...b.slides[0], content: 'A' }] };
  finish(); await work;
  assert.equal(published, false);
  current = { ...b, fontEpoch: 2 }; assert.equal(isCurrent(), false);
  current = { ...b, watermark: {} }; assert.equal(isCurrent(), false);
});
