import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSections } from '../../shared/sectionModel';
import { undoReducer, computePatch, applyProjectorPatch, MAX_HISTORY, type UndoState } from './undoReducer';
import type { Presentation } from '../types';

function initial(): UndoState {
  return { past: [], future: [], present: normalizeSections({ id: 'deck', name: 'Deck', zoom: 1, transition: { type: 'fade', duration: 400 },
    slides: [
      { id: 'a', type: 'text', content: 'Verse two', partsMode: true, parts: ['Verse one', 'Verse two'], activePart: 1, locked: true },
      { id: 'b', type: 'text', content: 'B' },
      { id: 'c', type: 'text', content: 'C' },
    ] } as Presentation) };
}

test('incremental multi-slide edit preserves sections, lock, untouched slides and active hymn part', () => {
  const start = initial();
  const edited = undoReducer(start, { type: 'EDIT_SLIDES', ids: ['a', 'b', 'a', 'missing'], edit: { kind: 'content', content: 'New verse' } });
  assert.equal(edited.present.sections, start.present.sections);
  assert.equal(edited.present.slides[2], start.present.slides[2]);
  assert.equal(edited.present.slides[0].locked, true);
  assert.deepEqual(edited.present.slides[0].parts, ['Verse one', 'New verse']);
  assert.equal(edited.past[0].slidesPatch.length, 2);
  assert.deepEqual(normalizeSections(edited.present), edited.present);
  assert.deepEqual(undoReducer(edited, { type: 'UNDO' }).present, start.present);
  const redone = undoReducer(undoReducer(edited, { type: 'UNDO' }), { type: 'REDO' });
  assert.deepEqual(redone.present, edited.present);
  const patch = computePatch(start.present, edited.present);
  assert.deepEqual(applyProjectorPatch(start.present, { slidesPatch: patch.slidesPatch }), edited.present);
});

test('no-op edits preserve state and redo; style edits retain background semantics', () => {
  const start = initial();
  assert.equal(undoReducer(start, { type: 'EDIT_SLIDES', ids: ['a'], edit: { kind: 'content', content: 'Verse two' } }), start);
  const styled = undoReducer(start, { type: 'EDIT_SLIDES', ids: ['b'], edit: { kind: 'styles', styles: { backgroundColor: '#f00' } } });
  assert.equal(styled.present.slides[1].styles?.backgroundExplicit, true);
  assert.equal(styled.present.slides[1].styles?.backgroundColor, '#f00');
  const undone = undoReducer(styled, { type: 'UNDO' });
  assert.equal(undoReducer(undone, { type: 'EDIT_SLIDES', ids: ['missing'], edit: { kind: 'content', content: '' } }), undone);
  assert.equal(undoReducer(undone, { type: 'EDIT_SLIDES', ids: ['b'], edit: { kind: 'content', content: 'x' } }).future.length, 0);
});

test('incremental history composes with reorder, add/remove and caps retained history', () => {
  const start = initial();
  let state = undoReducer(start, { type: 'SET', payload: { ...start.present, slides: [...start.present.slides].reverse() } });
  state = undoReducer(state, { type: 'EDIT_SLIDES', ids: ['a'], edit: { kind: 'content', content: 'After reorder' } });
  assert.equal(state.present.slides[2].content, 'After reorder');
  state = undoReducer(state, { type: 'UNDO' });
  state = undoReducer(state, { type: 'UNDO' });
  assert.deepEqual(state.present, start.present);
  for (let i = 0; i < MAX_HISTORY + 5; i++) state = undoReducer(state, { type: 'EDIT_SLIDES', ids: ['b'], edit: { kind: 'content', content: String(i) } });
  assert.equal(state.past.length, MAX_HISTORY);
  assert.equal(state.past[0].prevOrder, state.past.at(-1)!.nextOrder);
  const removed = undoReducer(state, { type: 'SET', payload: { ...state.present, slides: state.present.slides.filter(slide => slide.id !== 'b') } });
  const restored = undoReducer(removed, { type: 'UNDO' });
  assert.deepEqual(restored.present, state.present);
  assert.deepEqual(undoReducer(restored, { type: 'UNDO' }).present.slides.map(s => s.content), ['Verse two', '53', 'C']);
});
