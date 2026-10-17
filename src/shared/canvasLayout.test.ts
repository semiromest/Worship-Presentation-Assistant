import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFit, calculateCover, wrapCanvasText, canvasTypography, canvasLinePlacement } from './canvasLayout';

test('contain and cover keep aspect ratio and center portrait/landscape images', () => {
  assert.deepEqual(calculateFit(200, 100, 100, 100), { dx: 0, dy: 25, dw: 100, dh: 50 });
  assert.deepEqual(calculateFit(100, 200, 100, 100), { dx: 25, dy: 0, dw: 50, dh: 100 });
  assert.deepEqual(calculateCover(200, 100, 100, 100), { sx: 50, sy: 0, sw: 100, sh: 100 });
  assert.deepEqual(calculateCover(100, 200, 100, 100), { sx: 0, sy: 50, sw: 100, sh: 100 });
});

test('text wrapping retains blank paragraphs and never splits an oversized word', () => {
  const ctx = { measureText: (text: string) => ({ width: text.length * 10 }) };
  assert.deepEqual(wrapCanvasText(ctx, 'one two three\n\nlongword', 70), ['one two', 'three', '', 'longword']);
});

test('typography and placement scale from 1920 and retain adapter-specific minimum sizes', () => {
  for (const width of [320, 1920, 3840]) {
    const style = canvasTypography(
      {
        fontFamily: 'Example, sans-serif',
        fontSize: 48,
        fontStyle: 'italic',
        textAlign: 'right',
        verticalAlign: 'bottom',
      },
      width
    );
    assert.equal(style.fontSize, Math.max(8, 48 * (width / 1920)));
    assert.equal(style.font.includes('Example'), true);
    const pos = canvasLinePlacement(style, 2, width, (width * 9) / 16);
    assert.equal(pos.x, width - style.padding);
    assert.equal(pos.startY, (width * 9) / 16 - style.padding - 2 * style.lineHeight);
  }
  assert.equal(canvasTypography({ fontSize: 1 }, 320, 2).fontSize, 2);
});
