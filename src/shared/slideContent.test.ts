import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getActivePartIndex,
  getNextPartIndex,
  getPreviousPartIndex,
  getSlideDisplayContent,
} from './slideContent';

const slide = {
  content: 'legacy content',
  partsMode: true,
  parts: ['verse one', 'verse two', 'verse three'],
};

test('uses the active part as display content', () => {
  assert.equal(getSlideDisplayContent({ ...slide, activePart: 1 }), 'verse two');
});

test('clamps malformed active part indexes', () => {
  assert.equal(getActivePartIndex({ ...slide, activePart: -3 }), 0);
  assert.equal(getActivePartIndex({ ...slide, activePart: 99 }), 2);
  assert.equal(getActivePartIndex({ ...slide, activePart: Number.NaN }), 0);
});

test('preserves legacy content when parts mode is unavailable', () => {
  assert.equal(getSlideDisplayContent({ content: 'legacy content' }), 'legacy content');
  assert.equal(getSlideDisplayContent({ content: 'legacy content', partsMode: true, parts: [] }), 'legacy content');
});

test('navigates parts without crossing bounds', () => {
  assert.equal(getNextPartIndex({ ...slide, activePart: 1 }), 2);
  assert.equal(getNextPartIndex({ ...slide, activePart: 2 }), 2);
  assert.equal(getPreviousPartIndex({ ...slide, activePart: 1 }), 0);
  assert.equal(getPreviousPartIndex({ ...slide, activePart: 0 }), 0);
  assert.equal(getNextPartIndex({ content: 'plain text' }), null);
});
