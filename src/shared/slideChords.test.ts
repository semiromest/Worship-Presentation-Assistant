import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSlideChordKey, getSlideChordText, normalizeTranspose } from './slideChords';

const slide = {
  content: 'Amazing grace',
  partsMode: true,
  parts: ['Amazing grace', 'How sweet'],
  activePart: 1,
  chords: { parts: ['[G]Amazing [C]grace', '[D]How [G]sweet'], key: 'G', transpose: 3 },
};

test('stage chords follow the active part and the service transposition', () => {
  assert.equal(getSlideChordText(slide), '[F]How [Bb]sweet');
  assert.deepEqual(getSlideChordKey(slide), { from: 'G', to: 'Bb', transpose: 3 });
  assert.equal(getSlideChordText({ ...slide, activePart: 0, chords: { ...slide.chords, transpose: 0 } }), '[G]Amazing [C]grace');
});

test('stale chords (text edited after adding) and chord-less slides show nothing', () => {
  assert.equal(getSlideChordText({ ...slide, parts: ['Amazing grace', 'Edited text'] }), null);
  assert.equal(getSlideChordText({ content: 'x' }), null);
  assert.equal(getSlideChordText({ content: 'Amazing grace', chords: { parts: ['[G]Amazing grace'] } }), '[G]Amazing grace');
});

test('transposition wraps to -6..+6', () => {
  assert.equal(normalizeTranspose(7), -5);
  assert.equal(normalizeTranspose(-7), 5);
  assert.equal(normalizeTranspose(12), 0);
});
