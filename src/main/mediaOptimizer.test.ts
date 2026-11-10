import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createMediaLibrary } from './mediaLibrary';
import { createVideoSinks, optimizeLibraryImage } from './mediaOptimizer';
import { collectOptimizableMedia, replaceMediaRefs, videoTargetBitrate } from '../shared/mediaOptimize';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-optimize-'));
  return { dir, lib: createMediaLibrary(path.join(dir, 'media')) };
}

/** Noisy photo-like image: compresses poorly at high quality, well at 80. */
async function noisyJpeg(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761 >>> 24) & 255;
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

test('a large high-quality JPEG is re-encoded smaller and capped at 2560px', async () => {
  const { lib } = await fixture();
  const ref = await lib.storeBytes(await noisyJpeg(3200, 1800), 'jpg');
  assert.ok(ref);
  const result = await optimizeLibraryImage(lib, ref!);
  assert.ok(result, 'optimized');
  assert.ok(result!.after < result!.before * 0.95);
  const meta = await sharp(lib.urlToPath(result!.to)).metadata();
  assert.equal(Math.max(meta.width!, meta.height!), 2560);
});

test('small files, unknown refs and external paths are left alone', async () => {
  const { lib } = await fixture();
  const small = await lib.storeBytes(await sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } }).jpeg().toBuffer(), 'jpg');
  assert.equal(await optimizeLibraryImage(lib, small!), null);
  assert.equal(await optimizeLibraryImage(lib, 'local-resource://media/../../etc/passwd'), null);
  assert.equal(await optimizeLibraryImage(lib, 'C:\\Users\\x\\photo.jpg'), null);
});

test('transparent PNGs keep their alpha channel', async () => {
  const { lib } = await fixture();
  const raw = Buffer.alloc(1600 * 1200 * 4);
  for (let i = 0; i < raw.length; i++) raw[i] = i % 4 === 3 ? 128 : (i * 2654435761 >>> 24) & 255;
  const ref = await lib.storeBytes(await sharp(raw, { raw: { width: 1600, height: 1200, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer(), 'png');
  const result = await optimizeLibraryImage(lib, ref!);
  assert.ok(result);
  assert.equal((await sharp(lib.urlToPath(result!.to)).metadata()).hasAlpha, true);
});

test('video sink honours positions and stores a content-addressed file', async () => {
  const { dir } = await fixture();
  const sinks = createVideoSinks(path.join(dir, 'media'));
  const id = await sinks.begin();
  await sinks.write(id, 4, new Uint8Array([5, 6, 7, 8]));
  await sinks.write(id, 0, new Uint8Array([1, 2, 3, 4]));
  const done = await sinks.finish(id, '.mp4');
  assert.ok(done && done.ref.startsWith('local-resource://media/') && done.ref.endsWith('.mp4'));
  const stored = await fs.readFile(path.join(dir, 'media', done!.ref.split('/').pop()!));
  assert.deepEqual([...stored], [1, 2, 3, 4, 5, 6, 7, 8]);
  await assert.rejects(() => sinks.write('nope', 0, new Uint8Array(1)));
  const other = await sinks.begin();
  await assert.rejects(() => sinks.finish(other, '.exe'));
});

test('references are collected and replaced everywhere in a presentation tree', () => {
  const deck = {
    slides: [
      { id: 'a', mediaUrl: 'local-resource://media/aaaa.jpg', styles: { backgroundImage: 'local-resource://media/bbbb.png' }, items: [{ mediaUrl: 'local-resource://media/aaaa.jpg' }] },
      { id: 'b', type: 'video', mediaUrl: 'local-resource://media/cccc.mp4', content: 'local-resource://media/dddd.jpg' },
      { id: 'c', mediaUrl: 'https://example.com/x.jpg' },
    ],
  };
  const found = collectOptimizableMedia(deck);
  assert.deepEqual(found.image.sort(), ['local-resource://media/aaaa.jpg', 'local-resource://media/bbbb.png']);
  assert.deepEqual(found.video, ['local-resource://media/cccc.mp4']);
  const next = replaceMediaRefs(deck, new Map([['local-resource://media/aaaa.jpg', 'local-resource://media/new.jpg']]));
  assert.equal(next.slides[0].mediaUrl, 'local-resource://media/new.jpg');
  assert.equal(next.slides[0].items?.[0]?.mediaUrl, 'local-resource://media/new.jpg');
  assert.equal(next.slides[2], deck.slides[2], 'untouched branches are shared');
  assert.equal(deck.slides[0].mediaUrl, 'local-resource://media/aaaa.jpg', 'input is not mutated');
  assert.equal(replaceMediaRefs(deck, new Map()), deck);
});

test('video bitrate stays inside a sane projection range', () => {
  assert.equal(videoTargetBitrate(1920, 1080, 30), 4_354_560);
  assert.equal(videoTargetBitrate(3840, 2160, 60), 8_000_000);
  assert.equal(videoTargetBitrate(320, 180, 24), 1_200_000);
});
