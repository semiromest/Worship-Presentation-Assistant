import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { translateLibraryImage, type OcrFn } from './imageTranslate';
import { MEDIA_REF_PREFIX } from '../shared/mediaTree';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-translate-'));
  const canvas = createCanvas(800, 300);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(20, 40, 160)';
  ctx.fillRect(0, 0, 800, 300);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 60px Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('HELLO WORLD', 200, 120);
  const width = Math.ceil(ctx.measureText('HELLO WORLD').width);
  await fs.writeFile(path.join(dir, 'source.png'), canvas.toBuffer('image/png'));
  const box = { x0: 196, y0: 116, x1: 204 + width, y1: 186 };
  const stored: string[] = [];
  const deps = {
    dir,
    cacheDir: path.join(dir, 'cache'),
    storeBytes: async (data: Buffer, ext: string) => {
      const name = `out-${stored.length}${ext}`;
      await fs.writeFile(path.join(dir, name), data);
      stored.push(name);
      return MEDIA_REF_PREFIX + name;
    },
  };
  return { dir, box, deps, stored };
}

const ocrReturning = (box: { x0: number; y0: number; x1: number; y1: number }, text = 'HELLO WORLD'): OcrFn => async () => [
  { text, confidence: 92, bbox: box, lines: [{ text, confidence: 92, bbox: box, words: [{ text, confidence: 92, bbox: box }] }] },
];

test('paints out the original text and stores a translated copy', async () => {
  const { dir, box, deps, stored } = await fixture();
  const seen: unknown[] = [];
  const result = await translateLibraryImage(
    { ...deps, ocr: ocrReturning(box), translate: async (texts, from, to) => { seen.push(texts, from, to); return ['MERHABA']; } },
    { ref: `${MEDIA_REF_PREFIX}source.png`, source: 'en', target: 'tr' }
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(seen, [['HELLO WORLD'], 'en', 'tr']);
  assert.deepEqual(result.regions, [{ original: 'HELLO WORLD', translated: 'MERHABA' }]);
  assert.equal(stored.length, 1);
  assert.equal(path.extname(stored[0]), '.jpg', 'opaque source → jpeg');

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require('sharp');
  const { data, info } = await sharp(path.join(dir, stored[0])).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 800);
  assert.equal(info.height, 300);
  const px = (x: number, y: number) => [...data.subarray((y * 800 + x) * info.channels, (y * 800 + x) * info.channels + 3)] as number[];
  const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  assert.ok(near(px(20, 20), [20, 40, 160], 12), 'background far from the text is unchanged');
  // The right end of the old text ("…LD") is wider than "MERHABA" drawn centred: it must be background now.
  let white = 0;
  for (let y = box.y0 + 10; y < box.y1 - 10; y++) for (let x = box.x1 - 30; x < box.x1 - 4; x++) if (px(x, y)[0] > 200) white++;
  assert.equal(white, 0, 'old strokes were painted out');
  // The translation is drawn in white inside the box.
  let drawn = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) if (near(px(x, y), [255, 255, 255], 40)) drawn++;
  assert.ok(drawn > 500, `translation pixels drawn (${drawn})`);
});

test('reports no-text when OCR finds nothing worth translating', async () => {
  const { deps } = await fixture();
  const result = await translateLibraryImage({ ...deps, ocr: async () => [], translate: async () => [] }, { ref: `${MEDIA_REF_PREFIX}source.png`, source: 'auto', target: 'tr' });
  assert.deepEqual(result, { ok: false, reason: 'no-text' });
});

test('reports translate-failed and stores nothing when the service is down', async () => {
  const { box, deps, stored } = await fixture();
  const result = await translateLibraryImage(
    { ...deps, ocr: ocrReturning(box), translate: async () => { throw new Error('offline'); } },
    { ref: `${MEDIA_REF_PREFIX}source.png`, source: 'auto', target: 'tr' }
  );
  assert.deepEqual(result, { ok: false, reason: 'translate-failed', message: 'offline' });
  assert.equal(stored.length, 0);
});

test('translates images the editor picked from disk (file:// URLs)', async () => {
  const { dir, box, deps, stored } = await fixture();
  const ref = pathToFileURL(path.join(dir, 'source.png')).href;
  const result = await translateLibraryImage({ ...deps, ocr: ocrReturning(box), translate: async () => ['MERHABA'] }, { ref, source: 'en', target: 'tr' });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(stored.length, 1);
});

test('reports not-found for missing files, remote URLs and non-images', async () => {
  const { dir, deps } = await fixture();
  await fs.writeFile(path.join(dir, 'notes.txt'), 'x');
  for (const ref of [
    pathToFileURL(path.join(dir, 'missing.png')).href,
    'https://example.com/picture.png',
    pathToFileURL(path.join(dir, 'notes.txt')).href,
    `${MEDIA_REF_PREFIX}../escape.png`,
  ]) {
    const result = await translateLibraryImage(deps, { ref, source: 'auto', target: 'tr' });
    assert.deepEqual(result, { ok: false, reason: 'not-found' }, ref);
  }
});

test('names, logos and casing-only changes are not repainted', async () => {
  const { sameText, looksLikeName } = await import('./imageTranslate');
  assert.equal(sameText('ARKE KİLİSESİ', 'ARKE Kilisesi'), true);
  assert.equal(sameText('KİLİSE ADIMIZ', 'OUR CHURCH NAME'), false);
  assert.equal(looksLikeName('ARKE', 'ARCHE'), true);
  assert.equal(looksLikeName('WELCOME', 'HOŞ GELDİNİZ'), false);
  assert.equal(looksLikeName('KİLİSE ADIMIZ', 'OUR CHURCH NAME'), false);
  assert.equal(looksLikeName('merhaba', 'hello'), false);
});

test('finished translations are stored and reused by content, never redone', async () => {
  const { dir, box, deps, stored } = await fixture();
  const indexPath = path.join(dir, 'image-translations.json');
  let ocrCalls = 0;
  const run = (ref: string, cachedOnly = false) => translateLibraryImage(
    { ...deps, indexPath, ocr: async (...args) => { ocrCalls++; return ocrReturning(box)(...args); }, translate: async () => ['MERHABA'] },
    { ref, source: 'en', target: 'tr', cachedOnly },
  );
  const libraryRef = `${MEDIA_REF_PREFIX}source.png`;
  assert.deepEqual(await run(libraryRef, true), { ok: false, reason: 'not-cached' });
  const first = await run(libraryRef);
  assert.ok(first.ok && !first.cached);
  // Same picture under another path (e.g. picked from disk): served from the index.
  await fs.copyFile(path.join(dir, 'source.png'), path.join(dir, 'copy.png'));
  const second = await run(pathToFileURL(path.join(dir, 'copy.png')).href);
  assert.ok(second.ok && second.cached && first.ok && second.ref === first.ref);
  assert.equal(ocrCalls, 1);
  assert.equal(stored.length, 1);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.equal(Object.keys(index.entries).length, 1);
});

test('concurrent requests for the same picture share one job; no-text is remembered', async () => {
  const { dir, deps } = await fixture();
  const indexPath = path.join(dir, 'image-translations.json');
  let ocrCalls = 0;
  const d = { ...deps, indexPath, ocr: async () => { ocrCalls++; await new Promise((r) => setTimeout(r, 30)); return []; }, translate: async () => [] };
  const req = { ref: `${MEDIA_REF_PREFIX}source.png`, source: 'auto' as const, target: 'de' as const };
  const results = await Promise.all([translateLibraryImage(d, req), translateLibraryImage(d, req)]);
  assert.deepEqual(results, [{ ok: false, reason: 'no-text' }, { ok: false, reason: 'no-text' }]);
  assert.deepEqual(await translateLibraryImage(d, req), { ok: false, reason: 'no-text' });
  assert.equal(ocrCalls, 1);
});
