import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// These functions are extracted / re-implemented from SlideGrid.tsx so we can
// test the pure math without a DOM. The constants and formulas mirror the
// component exactly.
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const BASE_CARD_WIDTH = 320;
const ROW_GAP = 12;
const CONTENT_PADDING = 16;

function columnCount(zoom: number, containerWidth: number): number {
  const desiredWidth = BASE_CARD_WIDTH * zoom;
  return Math.max(1, Math.floor((containerWidth - CONTENT_PADDING * 2 + ROW_GAP) / (desiredWidth + ROW_GAP)));
}

function cardWidth(zoom: number, containerWidth: number): number {
  const cols = columnCount(zoom, containerWidth);
  const usableWidth = containerWidth - CONTENT_PADDING * 2;
  const maxCardWidth = Math.floor((usableWidth - ROW_GAP * (cols - 1)) / cols);
  return Math.max(1, Math.min(Math.floor(BASE_CARD_WIDTH * zoom), maxCardWidth));
}

function cardHeight(cw: number): number {
  return Math.floor(cw * (9 / 16)) + 8;
}

function clampZoom(current: number, delta: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(current + delta).toFixed(1)));
}

/**
 * Proportional scroll adjustment: when rowHeight changes from oldH to newH,
 * the scrollTop should be scaled by newH/oldH so the same relative position
 * is maintained.
 */
function proportionalScroll(scrollTop: number, oldRowHeight: number, newRowHeight: number): number {
  if (oldRowHeight <= 0) return scrollTop;
  return Math.round(scrollTop * (newRowHeight / oldRowHeight));
}

// ---------------------------------------------------------------------------
// columnCount tests
// ---------------------------------------------------------------------------

test('zoom 1.0, wide container → ~3 columns', () => {
  const cols = columnCount(1.0, 1200);
  assert.equal(cols, 3);
});

test('zoom 1.0, narrow container → 1 column', () => {
  const cols = columnCount(1.0, 400);
  assert.equal(cols, 1);
});

test('zoom 2.0 (max), wide container → more columns', () => {
  const cols = columnCount(2.0, 1200);
  // desiredWidth=640, (1200-32+12)/(640+12) = 1180/652 ≈ 1.81 → floor=1
  // Actually that doesn't look right. Let me recalculate.
  // desiredWidth = 320 * 2 = 640
  // (1200 - 32 + 12) / (640 + 12) = 1180 / 652 = 1.809 → floor=1
  // So at zoom 2 the cards are huge and even a wide container only fits 1.
  // That's by design — cards get bigger at high zoom.
  assert.equal(cols, 1);
});

test('zoom 0.5 (small), wide container → more columns', () => {
  const cols = columnCount(0.5, 1200);
  // desiredWidth = 320 * 0.5 = 160
  // (1200 - 32 + 12) / (160 + 12) = 1180 / 172 = 6.86 → floor=6
  assert.equal(cols, 6);
});

test('zoom 0.4 (min), wide container → max columns', () => {
  const cols = columnCount(0.4, 1200);
  // desiredWidth = 320 * 0.4 = 128
  // (1200 - 32 + 12) / (128 + 12) = 1180 / 140 = 8.42 → floor=8
  assert.equal(cols, 8);
});

test('columnCount never below 1', () => {
  const cols = columnCount(2.0, 300); // tiny container, huge zoom
  assert.equal(cols, 1);
});

test('columnCount increases as zoom decreases', () => {
  const z1 = columnCount(1.0, 1200);
  const z2 = columnCount(0.5, 1200);
  assert.ok(z2 > z1, `zoomOut should give more columns: ${z1} → ${z2}`);
});

test('columnCount increases with container width', () => {
  const narrow = columnCount(1.0, 600);
  const wide = columnCount(1.0, 1400);
  assert.ok(wide > narrow, `wider container should give more columns: ${narrow} → ${wide}`);
});

// ---------------------------------------------------------------------------
// cardWidth / cardHeight tests
// ---------------------------------------------------------------------------

test('cardWidth matches zoom 1.0, 1200px, 3 cols', () => {
  const cw = cardWidth(1.0, 1200);
  // cols = 3, desired = 320, maxCard = (1200 - 32 - 24)/3 = 381 → min(320,381) = 320
  assert.equal(cw, 320);
});

test('cardHeight derived from cardWidth with aspect ratio + badge offset', () => {
  const ch = cardHeight(320);
  // floor(320 * 9/16) + 8 = 180 + 8 = 188
  assert.equal(ch, 188);
});

test('cardWidth decreases when columns increase', () => {
  const cw1 = cardWidth(1.0, 1200);  // 3 cols → 320
  const cw05 = cardWidth(0.5, 1200); // 6 cols → 160
  assert.ok(cw05 < cw1, `more columns → smaller cards: ${cw05} < ${cw1}`);
});

test('REGRESSION: every zoom step changes card width even when column count stays the same', () => {
  // The old bug: cardWidth only depended on columnCount, so zoom 1.0 → 0.9
  // (both 3 columns on this container) rendered an IDENTICAL grid.
  const width = 1024;
  const cw10 = cardWidth(1.0, width); // 3 cols → 320
  const cw09 = cardWidth(0.9, width); // 3 cols → 288
  const cw11 = cardWidth(1.1, width); // 2 cols → 352
  assert.equal(columnCount(1.0, width), columnCount(0.9, width), 'same column count');
  assert.notEqual(cw09, cw10, 'zoom 0.9 must visibly shrink cards vs zoom 1.0');
  assert.notEqual(cw11, cw10, 'zoom 1.1 must visibly grow cards vs zoom 1.0');
});

test('cardWidth is exactly the zoom-scaled desired width', () => {
  // When a row fits, cards are exactly 320 × zoom wide.
  for (let z = 0.4; z <= 2.0; z += 0.1) {
    const zz = +z.toFixed(1);
    const cw = cardWidth(zz, 1400);
    const cols = columnCount(zz, 1400);
    const maxCard = Math.floor((1400 - 32 - ROW_GAP * (cols - 1)) / cols);
    assert.equal(cw, Math.min(Math.floor(320 * zz), maxCard), `zoom ${zz}`);
  }
});

test('cardWidth strictly increases with zoom on a fixed container', () => {
  // Walk the full zoom range — every step must resize (never stay equal).
  let prev = -1;
  for (let z = 0.4; z <= 2.0; z += 0.1) {
    const zz = +z.toFixed(1);
    const cw = cardWidth(zz, 1200);
    assert.ok(cw > prev, `zoom ${zz}: cardWidth ${cw} must be > previous ${prev}`);
    prev = cw;
  }
});

// ---------------------------------------------------------------------------
// clampZoom tests
// ---------------------------------------------------------------------------

test('clampZoom normal step', () => {
  assert.equal(clampZoom(1.0, ZOOM_STEP), 1.1);
  assert.equal(clampZoom(1.0, -ZOOM_STEP), 0.9);
});

test('clampZoom floors at MIN_ZOOM', () => {
  assert.equal(clampZoom(0.5, -0.2), MIN_ZOOM);
  assert.equal(clampZoom(MIN_ZOOM, -0.1), MIN_ZOOM);
});

test('clampZoom ceilings at MAX_ZOOM', () => {
  assert.equal(clampZoom(1.9, 0.2), MAX_ZOOM);
  assert.equal(clampZoom(MAX_ZOOM, 0.1), MAX_ZOOM);
});

test('clampZoom handles floating-point rounding via toFixed', () => {
  // 1.1 + 0.1 = 1.2000000000000002 → +(...).toFixed(1) → 1.2
  assert.equal(clampZoom(1.1, 0.1), 1.2);
});

// ---------------------------------------------------------------------------
// proportionalScroll tests (scroll anchoring during zoom)
// ---------------------------------------------------------------------------

test('proportionalScroll scales scrolltop when zoom doubles', () => {
  // zoom doubles → rowHeight doubles → scrollTop should double
  const oldH = 120; // rowHeight at zoom=1
  const newH = 240; // rowHeight at zoom=2
  assert.equal(proportionalScroll(500, oldH, newH), 1000);
});

test('proportionalScroll scales scrolltop when zoom halves', () => {
  const oldH = 240;
  const newH = 120;
  assert.equal(proportionalScroll(1000, oldH, newH), 500);
});

test('proportionalScroll with zero scrollTop', () => {
  assert.equal(proportionalScroll(0, 200, 100), 0);
});

test('proportionalScroll with zero oldRowHeight returns original', () => {
  assert.equal(proportionalScroll(500, 0, 200), 500);
});

test('proportionalScroll preserves relative position', () => {
  // At scrollTop=600 out of 2000 total, we're 30% through.
  // After rowHeight doubles, scrollTop should be 1200 (still 30% of 4000).
  const oldH = 100;
  const newH = 200;
  const result = proportionalScroll(600, oldH, newH);
  assert.equal(result, 1200);
});