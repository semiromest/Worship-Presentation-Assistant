import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveSelectedInOrder, assignSection, moveSection, sectionGroups } from './serviceSections';
import { getNextDisplaySlide, getSlideDisplayContent } from './slideContent';
import { computePatch, applyProjectorPatch, undoReducer } from '../renderer/state/undoReducer';
import type { Slide, Presentation } from '../renderer/types';
const slides: Slide[] = ['a','b','c','d'].map(id => ({ id, type: 'text', content: id }));
const ids = (items: Slide[]) => items.map(s => s.id);
test('multi-selection moves one position without reversing adjacent or disjoint selections', () => {
  assert.deepEqual(ids(moveSelectedInOrder(slides, new Set(['b','c']), -1)), ['b','c','a','d']);
  assert.deepEqual(ids(moveSelectedInOrder(slides, new Set(['b','c']), 1)), ['a','d','b','c']);
  assert.deepEqual(ids(moveSelectedInOrder(slides, new Set(['b','d']), -1)), ['b','a','d','c']);
  assert.deepEqual(ids(moveSelectedInOrder(slides, new Set(['a','b']), -1)), ids(slides));
});
test('sections preserve order and move together; assignments survive undo and projector patches', () => {
  const original: Presentation = { name: 'test', slides };
  const next = { ...original, slides: assignSection(slides, new Set(['b','c']), { id:'worship', title:'Worship' }) };
  assert.deepEqual(ids(next.slides), ['a','d','b','c']);
  assert.equal(sectionGroups(next.slides).length, 2);
  assert.deepEqual(ids(moveSection(next.slides, 1, -1)), ['b','c','a','d']);
  const state = undoReducer({ present: original, past: [], future: [] }, { type:'SET', payload:next });
  assert.deepEqual(undoReducer(state, { type:'UNDO' }).present.slides, original.slides);
  const patch = computePatch(original, next);
  assert.deepEqual(applyProjectorPatch(original, { slidesPatch:patch.slidesPatch, nextOrder:patch.nextOrder }).slides, next.slides);
});
test('stage next cue shows next part, then next slide, then end', () => {
  const song = { ...slides[0], partsMode:true, parts:['Verse','Chorus'], activePart:0 };
  assert.equal(getSlideDisplayContent(getNextDisplaySlide([song,slides[1]], 0)!), 'Chorus');
  assert.equal(getNextDisplaySlide([{ ...song, activePart:1 },slides[1]], 0)?.id, 'b');
  assert.equal(getNextDisplaySlide([song,slides[1]], 1), undefined);
});
