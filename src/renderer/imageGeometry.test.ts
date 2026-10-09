import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FULL_CROP, normalizeCrop, sourceCrop, fitCropRatio, moveCrop, resizeCrop } from './imageGeometry';

test('source crops normalize malformed data and stay inside original pixels', () => {
  assert.deepEqual(normalizeCrop({ x: Infinity, y: -10, width: NaN, height: 120 }), FULL_CROP);
  assert.deepEqual(moveCrop({ x: 10, y: 20, width: 30, height: 40 }, 100, -100), {
    x: 70,
    y: 0,
    width: 30,
    height: 40,
  });
});

test('legacy frame clipping converts contain, cover, fill, and flipped images to source coordinates', () => {
  const source = { width: 200, height: 100 },
    frame = { width: 100, height: 100 };
  assert.deepEqual(sourceCrop({ objectFit: 'contain', crop: { x: 25, y: 25, width: 50, height: 50 } }, source, frame), {
    x: 25,
    y: 0,
    width: 50,
    height: 100,
  });
  assert.deepEqual(sourceCrop({ objectFit: 'cover', crop: FULL_CROP }, source, frame), {
    x: 25,
    y: 0,
    width: 50,
    height: 100,
  });
  assert.deepEqual(
    sourceCrop({ objectFit: 'fill', flipX: true, crop: { x: 10, y: 20, width: 30, height: 40 } }, source, frame),
    { x: 60, y: 20, width: 30, height: 40 }
  );
  assert.deepEqual(
    sourceCrop({ cropMode: 'source', crop: { x: 10, y: 20, width: 30, height: 40 }, flipX: true }, source, frame),
    { x: 10, y: 20, width: 30, height: 40 }
  );
});

test('all aspect presets use source pixel proportions on landscape and portrait images', () => {
  for (const source of [
    { width: 1600, height: 900 },
    { width: 900, height: 1600 },
  ]) {
    for (const ratio of [1, 4 / 3, 16 / 9, source.width / source.height, 2]) {
      const crop = fitCropRatio(FULL_CROP, ratio, source);
      assert.ok(Math.abs((crop.width * source.width) / (crop.height * source.height) - ratio) < 1e-8);
      assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 100 && crop.y + crop.height <= 100);
    }
  }
});

test('each crop corner preserves its opposite anchor and ratio at boundaries', () => {
  const start = { x: 20, y: 20, width: 40, height: 30 };
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    const next = resizeCrop(start, corner, 15, 10, 4 / 3);
    assert.ok(Math.abs(next.width / next.height - 4 / 3) < 1e-8);
    assert.equal(corner.endsWith('l') ? next.x + next.width : next.x, corner.endsWith('l') ? 60 : 20);
    assert.equal(corner.startsWith('t') ? next.y + next.height : next.y, corner.startsWith('t') ? 50 : 20);
    const large = resizeCrop(start, corner, 1000, 1000, 4 / 3);
    assert.ok(large.x >= 0 && large.y >= 0 && large.x + large.width <= 100 && large.y + large.height <= 100);
  }
});
