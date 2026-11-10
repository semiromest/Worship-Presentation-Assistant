import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentSignature, sameDocument } from './documentFingerprint';
import type { Presentation, Slide } from './types';
const deck = (slides: Slide[]): Presentation => ({ id: 'p', name: 'Sunday', slides });
const slide = (id: string): Slide => ({ id, type: 'text', content: 'Text ' + id });
test('unchanged immutable slides are serialized once across document edits', () => {
  let reads = 0;
  const slides = Array.from({ length: 1000 }, (_, i) => ({ ...slide(String(i)), get content() { reads++; return 'Text ' + i; } }));
  const original = deck(slides), baseline = documentSignature(original);
  assert.equal(reads, 1000);
  for (let i = 0; i < 20; i++) assert.equal(sameDocument(baseline, documentSignature({ ...original, liveIndex: i, slides: [...slides] })), true);
  assert.equal(reads, 1000, 'navigation and unchanged slide references do not reserialize content');
  const changed = { ...original, slides: slides.map((s, i) => i === 500 ? { ...s, content: 'Edited' } : s) };
  assert.equal(sameDocument(baseline, documentSignature(changed)), false);
  assert.equal(sameDocument(baseline, documentSignature(original)), true, 'undo restores exact content equality');
});
test('navigation is ignored; parts, ordering, styles and unknown future fields are preserved', () => {
  const hymn = { ...slide('h'), partsMode: true, parts: ['One', 'Two'], activePart: 0, content: 'One' };
  const original = deck([hymn, slide('b')]), baseline = documentSignature(original);
  assert.equal(sameDocument(baseline, documentSignature({ ...original, zoom: 2, liveIndex: 1, slides: [{ ...hymn, activePart: 1, content: 'Two' }, original.slides[1]] })), true);
  for (const next of [
    { ...original, name: 'New name' }, { ...original, slides: [...original.slides].reverse() },
    { ...original, slides: [{ ...hymn, parts: ['Changed', 'Two'] }, original.slides[1]] },
    { ...original, slides: [{ ...hymn, futureVisualSetting: { x: 2 } }, original.slides[1]] },
  ]) assert.equal(sameDocument(baseline, documentSignature(next)), false);
  assert.equal(sameDocument(baseline, documentSignature(structuredClone(original))), true);
});
