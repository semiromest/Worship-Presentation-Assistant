import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBuffer,
  buildDeckIndex,
  collectSlideText,
  evaluateTracking,
  foldText,
  tokenize,
} from './slideMatcher';
import type { Slide } from '../types';

function slide(type: Slide['type'], content: string, extra: Partial<Slide> = {}): Slide {
  return { id: `${type}-${Math.random()}`, type, content, ...extra } as Slide;
}

test('foldText folds Turkish characters to ASCII', () => {
  assert.equal(foldText('Şeker ÇİLEK IĞDIR İstanbul'), 'seker cilek igdir istanbul');
});

test('tokenize strips punctuation and apostrophes', () => {
  assert.deepEqual(tokenize("Rab'be, övgüler... sunun!"), ['rabbe', 'ovguler', 'sunun']);
});

test('collectSlideText includes parts, content and item text', () => {
  const s = slide('text', 'seed', {
    partsMode: true,
    parts: ['birinci kıta', 'ikinci kıta'],
    items: [{ type: 'text', content: 'öğe metni', x: 0, y: 0, width: 0, height: 0, zIndex: 0, styles: {} }],
  } as Partial<Slide>);
  const text = collectSlideText(s);
  assert.ok(text.includes('birinci kıta'));
  assert.ok(text.includes('ikinci kıta'));
  assert.ok(text.includes('seed'));
  assert.ok(text.includes('öğe metni'));
});

test('buildDeckIndex indexes only text slides with correct indices', () => {
  const deck = buildDeckIndex([
    slide('text', 'ilk slayt metni'),
    slide('image', 'resim'),
    slide('text', 'ikinci slayt metni'),
  ]);
  assert.equal(deck.docs.length, 2);
  assert.deepEqual(deck.docs.map((d) => d.index), [0, 2]);
});

test('evaluateTracking confidently locates the spoken line', () => {
  const deck = buildDeckIndex([
    slide('text', 'Kutsal kutsal kutsal Rab Tanrı'),
    slide('text', 'Yer ve gök seninle dolu'),
    slide('text', 'Hosanna en yücelerde'),
  ]);
  const decision = evaluateTracking(buildBuffer('yer ve gök seninle dolu'), deck, 0, 50)!;
  assert.equal(decision.index, 1);
  assert.ok(decision.confident);
  assert.ok(decision.score > 0.5);
});

test('recency: the newest line wins over earlier lines still in the window', () => {
  const deck = buildDeckIndex([
    slide('text', 'Kutsal kutsal kutsal Rab Tanrı'),
    slide('text', 'Yer ve gök seninle dolu'),
    slide('text', 'Hosanna en yücelerde'),
  ]);
  const decision = evaluateTracking(
    buildBuffer('kutsal kutsal kutsal rab tanrı yer ve gök seninle dolu'),
    deck,
    0,
    50,
  )!;
  assert.equal(decision.index, 1);
});

test('near-duplicate lines are separated by word order', () => {
  const deck = buildDeckIndex([
    slide('text', "Rab'be övgüler sunun"),
    slide('text', "Rab'be şükürler sunun"),
  ]);
  const decision = evaluateTracking(buildBuffer("rab'be şükürler sunun"), deck, 0, 50)!;
  assert.equal(decision.index, 1);
  assert.ok(decision.confident);
});

test('unrelated speech is not confident', () => {
  const deck = buildDeckIndex([
    slide('text', 'Kutsal kutsal kutsal Rab Tanrı'),
    slide('text', 'Yer ve gök seninle dolu'),
  ]);
  const decision = evaluateTracking(buildBuffer('bugün hava çok güzel olacak'), deck, 0, 50)!;
  assert.equal(decision.confident, false);
});

test('decision flags backward candidates', () => {
  const deck = buildDeckIndex([
    slide('text', 'birinci dize burada'),
    slide('text', 'ikinci dize şurada'),
  ]);
  const decision = evaluateTracking(buildBuffer('birinci dize burada'), deck, 1, 50)!;
  assert.equal(decision.index, 0);
  assert.equal(decision.backward, true);
});

test('prefix fast-path: first two words of the next slide switch immediately', () => {
  const deck = buildDeckIndex([
    slide('text', 'Kutsal kutsal kutsal Rab Tanrı her şeye kadir'),
    slide('text', 'Yer ve gök seninle dolu'),
    slide('text', 'Hosanna en yücelerde'),
  ]);
  // Previous slide fully spoken + only the first two words of slide 3.
  const decision = evaluateTracking(
    buildBuffer('kutsal kutsal kutsal rab tanrı her şeye kadir hosanna en'),
    deck,
    0,
    50,
  )!;
  assert.equal(decision.index, 2);
  assert.ok(decision.confident);
  assert.ok(decision.fastPath);
});

test('shared opening words are not mistaken for the later slide', () => {
  const deck = buildDeckIndex([
    slide('text', 'İlk slaytın kendi metni'),
    slide('text', 'Ortak başlangıç birinci dize'),
    slide('text', 'Ortak başlangıç ikinci dize'),
  ]);

  // Only the shared opening is spoken — must not jump to the second twin.
  const ambiguous = evaluateTracking(buildBuffer('şimdi ortak başlangıç'), deck, 0, 50)!;
  assert.notEqual(ambiguous.index, 2);

  // The distinguishing word resolves it to slide 2 immediately.
  const decided = evaluateTracking(buildBuffer('şimdi ortak başlangıç ikinci'), deck, 0, 50)!;
  assert.equal(decided.index, 2);
  assert.ok(decided.confident);
  assert.ok(decided.fastPath);
});
