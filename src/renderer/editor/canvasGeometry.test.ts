import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  moveBounds,
  resizeBounds,
  resizeItemBounds,
  rotateBounds,
  screenDelta,
  type ResizeCorner,
} from './canvasGeometry';

test('invalid grid spacing does not corrupt item coordinates', () => {
  const start = { x: 10, y: 10, width: 20, height: 20 };
  for (const grid of [NaN, Infinity, -1]) {
    assert.deepEqual(moveBounds(start, 2, 3, grid), { ...start, x: 12, y: 13 });
    assert.deepEqual(resizeBounds(start, 'br', 2, 3, grid), { ...start, width: 22, height: 23 });
  }
});

test('screen movement follows the pointer at 50%, 100%, and 200% zoom', () => {
  for (const zoom of [0.5, 1, 2]) {
    const rect = { width: 1000 * zoom, height: 500 * zoom };
    const delta = screenDelta(100 * zoom, 50 * zoom, rect);
    assert.deepEqual(delta, { x: 10, y: 10 });
    const bounds = moveBounds({ x: 20, y: 20, width: 20, height: 20 }, delta.x, delta.y);
    assert.equal(((bounds.x - 20) / 100) * rect.width, 100 * zoom);
  }
  assert.deepEqual(screenDelta(10, 10, { width: 0, height: 0 }), { x: 0, y: 0 });
});

test('all resize corners preserve their opposite anchor across zoom levels', () => {
  const start = { x: 20, y: 20, width: 30, height: 30 };
  const expected = {
    tl: { x: 25, y: 25, width: 25, height: 25 },
    tr: { x: 20, y: 25, width: 35, height: 25 },
    bl: { x: 25, y: 20, width: 25, height: 35 },
    br: { x: 20, y: 20, width: 35, height: 35 },
  };
  for (const zoom of [0.5, 1, 2]) {
    const delta = screenDelta(50 * zoom, 25 * zoom, { width: 1000 * zoom, height: 500 * zoom });
    for (const corner of Object.keys(expected) as ResizeCorner[]) {
      assert.deepEqual(resizeBounds(start, corner, delta.x, delta.y), expected[corner]);
    }
  }
});

test('snapped moves and resizes stay inside the slide and preserve minimum size', () => {
  const start = { x: 10, y: 10, width: 23, height: 23 };
  assert.equal(moveBounds(start, 100, 100, 10).x, 77);
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    for (const delta of [-200, 200]) {
      const next = resizeBounds(start, corner, delta, delta, 10);
      assert.ok(next.width >= 4 && next.height >= 4);
      assert.ok(next.x >= 0 && next.y >= 0);
      assert.ok(next.x + next.width <= 100 && next.y + next.height <= 100);
    }
  }
});

test('rotation uses the element center instead of the canvas center', () => {
  const start = { x: 10, y: 10, width: 20, height: 20, rotation: 350 };
  for (const zoom of [0.5, 1, 2]) {
    const rect = { left: 100, top: 50, width: 1000 * zoom, height: 500 * zoom };
    const center = { x: rect.left + rect.width * 0.2, y: rect.top + rect.height * 0.2 };
    assert.equal(rotateBounds(start, rect, { x: center.x + 10, y: center.y }, { x: center.x, y: center.y + 10 }), 80);
  }
});

test('rotated corner resizing follows local axes and preserves the opposite displayed corner', () => {
  const start = { x: 30, y: 30, width: 20, height: 20, rotation: 90 };
  const displayedCorner = (item: typeof start, sx: number, sy: number, width: number, height: number) => {
    const cx = ((item.x + item.width / 2) / 100) * width;
    const cy = ((item.y + item.height / 2) / 100) * height;
    return { x: cx - ((sy * item.height) / 200) * height, y: cy + ((sx * item.width) / 200) * width };
  };
  for (const zoom of [0.5, 1, 2]) {
    const rect = { width: 1000 * zoom, height: 500 * zoom };
    for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
      const next = { ...resizeItemBounds(start, corner, 0, 50 * zoom, rect), rotation: 90 };
      assert.ok(Math.abs(next.height - start.height) < 0.0001);
      assert.ok(Math.abs(next.width - (corner.endsWith('l') ? 15 : 25)) < 0.0001);
      const sx = corner.endsWith('l') ? 1 : -1;
      const sy = corner.startsWith('t') ? 1 : -1;
      const before = displayedCorner(start, sx, sy, rect.width, rect.height);
      const after = displayedCorner(next, sx, sy, rect.width, rect.height);
      assert.ok(Math.abs(before.x - after.x) < 0.0001 && Math.abs(before.y - after.y) < 0.0001);
    }
  }
});
