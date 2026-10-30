import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImagePreviewSource, imagePreviewEdge, preparePreviewImages } from './imagePreviewSource';
import { createPosterQueue } from './components/mediaPosterQueue';
import type { Slide } from './types';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('preview sizes follow physical pixels without multiplying cache keys on every resize', () => {
  assert.equal(imagePreviewEdge(220), 256);
  assert.equal(imagePreviewEdge(300), 512);
  assert.equal(imagePreviewEdge(320, 2), 1024);
  assert.equal(imagePreviewEdge(20000, 4), 2048);
  assert.equal(imagePreviewEdge(NaN), 512);
});

test('image jobs deduplicate per size and skip obsolete queued sources, with at most two active', async () => {
  const calls: string[] = [], finish: Array<() => void> = [];
  const cache = createImagePreviewSource((source, edge) => new Promise(resolve => {
    calls.push(`${source}:${edge}`);
    finish.push(() => resolve(`local-resource://thumbs/${source}-${edge}.webp`));
  }));
  const first = cache.request('a', 512);
  assert.equal(cache.request('a', 512), first);
  const second = cache.request('a', 1024);
  let mounted = true;
  const stale = cache.request('gone', 512, () => mounted);
  await tick();
  assert.deepEqual(calls, ['a:512', 'a:1024']);
  mounted = false;
  finish.forEach(resolve => resolve());
  assert.equal(await stale, null);
  await Promise.all([first, second]);
  assert.equal(cache.peek('a', 512), 'local-resource://thumbs/a-512.webp');
  assert.equal(calls.length, 2);
});

test('successful reference expiry revalidates source files; peek never returns stale values', async () => {
  let now = 0, loads = 0;
  const cache = createPosterQueue(async () => `thumb-${++loads}`, 2, { successTtlMs: 10, now: () => now });
  await cache.request('file', () => true);
  assert.equal(cache.peek('file'), 'thumb-1');
  now = 10;
  assert.equal(cache.peek('file'), undefined);
  assert.equal(await cache.request('file', () => true), 'thumb-2');
});

test('bounded preview inputs preserve original document references, nested images and failed sources', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {
    getMediaThumbnail: async (source: string) => {
      calls.push(source);
      return source.endsWith('missing.jpg') ? null : `local-resource://thumbs/${source.split('/').pop()}.webp`;
    },
  } } });
  try {
    const slide = {
      id: 'preview', type: 'image', content: '', mediaUrl: 'file:///C:/preview-main.jpg',
      styles: { backgroundImage: 'file:///C:/preview-bg.jpg' },
      items: [{ id: 'group', type: 'group', groupItems: [{ id: 'nested', type: 'image', mediaUrl: 'file:///C:/preview-nested.jpg' }] }],
      loopItems: [{ type: 'image', mediaUrl: 'file:///C:/missing.jpg' }],
    } as Slide;
    const original = JSON.stringify(slide);
    const result = await preparePreviewImages(slide, 512);
    assert.equal(JSON.stringify(slide), original);
    assert.notEqual(result.mediaUrl, slide.mediaUrl);
    assert.notEqual(result.styles?.backgroundImage, slide.styles?.backgroundImage);
    assert.ok(result.items?.[0].groupItems?.[0].mediaUrl?.startsWith('local-resource://thumbs/'));
    assert.equal(result.loopItems?.[0].mediaUrl, '');
    assert.equal(calls.length, 4);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
