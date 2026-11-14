import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTextMask, detectAlign, estimateColors, fitText, isReadableLine, selectRegions, splitBlocks, splitLineSegments, weightFromStroke, wrapText,
  type OcrLine, type OcrParagraph, type TextRegion,
} from './imageTextLayout';

const line = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90): OcrLine => ({
  text, confidence, bbox: { x0, y0, x1, y1 },
  words: [{ text, confidence, bbox: { x0, y0, x1, y1 } }],
});
const para = (...lines: OcrLine[]): OcrParagraph => ({ text: lines.map((l) => l.text).join('\n'), confidence: 90, bbox: lines[0].bbox, lines });

test('selectRegions drops noise and low-confidence lines, joins hyphenated words', () => {
  const regions = selectRegions([
    para(line('Amazing gra-', 100, 100, 500, 140), line('ce how sweet', 120, 150, 480, 190)),
    para(line('|| ~', 10, 10, 30, 20)),
    para(line('Blurry text', 10, 300, 200, 330, 20)),
  ], 1000);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].text, 'Amazing grace how sweet');
  assert.deepEqual(regions[0].bbox, { x0: 100, y0: 100, x1: 500, y1: 190 });
  assert.equal(regions[0].lineHeight, 40);
  assert.equal(regions[0].linePitch, 50);
});

test('selectRegions splits a title from the body under it and fixes a lone "|"', () => {
  const regions = selectRegions([
    para(
      line('Welcome to Sunday Worship', 200, 200, 1080, 270),
      line('The Lord is my shepherd,', 400, 380, 880, 420),
      line('| shall not want.', 480, 440, 800, 480),
    ),
  ], 1280);
  assert.deepEqual(regions.map((r) => r.text), ['Welcome to Sunday Worship', 'The Lord is my shepherd, I shall not want.']);
  assert.equal(regions[0].lineHeight, 70);
  assert.equal(regions[1].lineHeight, 40);
});

test('detectAlign reads left, centred and right blocks', () => {
  assert.equal(detectAlign([line('a', 100, 0, 400, 10), line('b', 100, 20, 250, 30)], 1000), 'left');
  assert.equal(detectAlign([line('a', 100, 0, 500, 10), line('b', 200, 20, 400, 30)], 1000), 'center');
  assert.equal(detectAlign([line('a', 100, 0, 900, 10), line('b', 600, 20, 900, 30)], 1000), 'right');
  assert.equal(detectAlign([line('title', 400, 0, 600, 10)], 1000), 'center');
  assert.equal(detectAlign([line('note', 20, 0, 200, 10)], 1000), 'left');
});

/** White "text" bars on a blue picture. */
function picture(width: number, height: number, bars: { x0: number; y0: number; x1: number; y1: number }[]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) rgba.set([20, 40, 160, 255], p * 4);
  for (const b of bars) for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) rgba.set([250, 250, 250, 255], (y * width + x) * 4);
  return rgba;
}

const region = (l: OcrLine): TextRegion => ({ text: l.text, bbox: l.bbox, lines: [l], lineHeight: l.bbox.y1 - l.bbox.y0, linePitch: l.bbox.y1 - l.bbox.y0, align: 'center' });

test('estimateColors tells the text colour from the background', () => {
  // Thin strokes inside the line box, like letters.
  const strokes = [0, 1, 2, 3, 4].map((i) => ({ x0: 52 + i * 18, y0: 42, x1: 58 + i * 18, y1: 78 }));
  const rgba = picture(200, 120, strokes);
  const colors = estimateColors(rgba, 200, 120, region(line('Hello', 50, 40, 140, 80)));
  assert.deepEqual(colors.text, [250, 250, 250]);
  assert.deepEqual(colors.background, [20, 40, 160]);
});

test('buildTextMask covers the strokes but not the open background', () => {
  const strokes = [0, 1, 2, 3, 4].map((i) => ({ x0: 52 + i * 18, y0: 42, x1: 58 + i * 18, y1: 78 }));
  const rgba = picture(200, 120, strokes);
  const r = region(line('Hello', 50, 40, 140, 80));
  const { mask, bounds, inkRatio } = buildTextMask(rgba, 200, 120, r, { text: [250, 250, 250], background: [20, 40, 160] });
  assert.equal(mask[60 * 200 + 55], 255, 'stroke pixel masked');
  assert.equal(mask[5 * 200 + 5], 0, 'far background untouched');
  assert.ok(inkRatio > 0.1 && inkRatio < 0.6);
  assert.ok(bounds.x0 <= 50 && bounds.x1 >= 140 && bounds.y0 <= 40 && bounds.y1 >= 80);
});

const mono: (text: string, size: number) => number = (text, size) => text.length * size * 0.5;

test('wrapText breaks greedily on spaces', () => {
  assert.deepEqual(wrapText(mono, 'aa bb cc dd', 10, 25), ['aa bb', 'cc dd']);
  assert.deepEqual(wrapText(mono, 'averyveryverylongword x', 10, 25), ['averyveryverylongword', 'x']);
});

test('fitText keeps the original size when it fits and shrinks long translations', () => {
  const r = region(line('Hi there', 0, 0, 400, 40));
  const short = fitText(mono, 'Merhaba', r);
  assert.equal(short.fontSize, 42);
  assert.deepEqual(short.lines, ['Merhaba']);

  const long = fitText(mono, 'Bu çok daha uzun bir çeviri metnidir ve sığması gerekir', r);
  assert.ok(long.fontSize < 42 && long.fontSize >= 6);
  for (const l of long.lines) assert.ok(mono(l, long.fontSize) <= 400 * 1.02);
  assert.ok(long.lines.length * long.lineHeight - (long.lineHeight - long.fontSize) <= 40 * 1.15 + 0.01);
});

test('stroke width tells bold from regular text across sizes and letter shapes', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const cases: [string, string, string][] = [
    ['Welcome to Sunday Worship', 'bold 72px Arial', 'bold '],
    ['Welcome to Sunday Worship', '72px Arial', ''],
    ['The Lord is my shepherd', '40px Arial', ''],
    ['The Lord is my shepherd', 'bold 40px Arial', 'bold '],
    ['AMAZING GRACE', '40px Arial', ''],
    ['AMAZING GRACE', 'bold 60px Arial', 'bold '],
    ['sun moon ocean', '60px Arial', ''],
    ['sun moon ocean', 'bold 60px Arial', 'bold '],
  ];
  for (const [text, font, expected] of cases) {
    const canvas = createCanvas(1400, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#203060'; ctx.fillRect(0, 0, 1400, 200);
    ctx.fillStyle = '#ffffff'; ctx.font = font; ctx.fillText(text, 20, 130);
    const m = ctx.measureText(text);
    const bbox = { x0: 20, y0: Math.floor(130 - m.actualBoundingBoxAscent), x1: Math.ceil(20 + m.width), y1: Math.ceil(130 + m.actualBoundingBoxDescent) };
    const r = region({ text, confidence: 90, bbox, words: [{ text, confidence: 90, bbox }] });
    const data = ctx.getImageData(0, 0, 1400, 200).data;
    const { strokeRatio } = buildTextMask(data, 1400, 200, r, estimateColors(data, 1400, 200, r));
    assert.equal(weightFromStroke(strokeRatio), expected, `${font} "${text}" → ${strokeRatio.toFixed(3)}`);
  }
});

test('a logo word beside a text column is split off and kept out of the column block', () => {
  const words = [
    { text: 'ARKE', confidence: 90, bbox: { x0: 190, y0: 540, x1: 360, y1: 590 } },
    { text: 'Ev', confidence: 88, bbox: { x0: 525, y0: 520, x1: 560, y1: 545 } },
    { text: 'arche', confidence: 88, bbox: { x0: 570, y0: 520, x1: 650, y1: 545 } },
  ];
  const merged: OcrLine = { text: 'ARKE Ev arche', confidence: 89, bbox: { x0: 190, y0: 520, x1: 650, y1: 590 }, words };
  const segments = splitLineSegments(merged);
  assert.deepEqual(segments.map((s) => s.text), ['ARKE', 'Ev arche']);
  assert.equal(segments[1].bbox.x0, 525);

  const column = [line('Başlangıçta Söz vardı ve', 525, 400, 1000, 425), line('Söz Tanrıydı', 525, 432, 700, 457)];
  const logo = line('ARKE', 190, 420, 360, 445);
  const blocks = splitBlocks([...column, logo]);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.find((b) => b.length === 2)!.map((l) => l.text), ['Başlangıçta Söz vardı ve', 'Söz Tanrıydı']);
});

test('isReadableLine drops other-script junk and symbol noise for a known source language', () => {
  assert.equal(isReadableLine(line('Başlangıçta Söz vardı', 0, 0, 100, 20), 'tr'), true);
  // Greek read with the Turkish model.
  assert.equal(isReadableLine(line('Ev åpxñ ñv ó Aóyoc, kai ó Aóyoc', 0, 0, 100, 20), 'tr'), false);
  assert.equal(isReadableLine(line('*{}| ©© )*', 0, 0, 100, 20)), false);
  assert.equal(isReadableLine(line('Hello world', 0, 0, 100, 20, 55)), false, 'low confidence');
  assert.equal(isReadableLine(line('Mañana', 0, 0, 100, 20), 'es'), true);
});
