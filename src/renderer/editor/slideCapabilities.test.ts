import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Slide, Presentation } from '../types';
import { editorFilterTarget, filteredEditorSlides, isItemEditableSlide } from './slideCapabilities';
import { createEditorHistory, editorDeckReducer } from './useEditorDeck';
import { applyDraftsToDeck, createDraft } from './slideDraft';

const slide = (id: string, type: Slide['type'] = 'text', extra: Partial<Slide> = {}): Slide => ({ id, type, content: id, ...extra });

test('filter retains original order and falls forward then backward', () => {
  const slides = [slide('a'), slide('v', 'video'), slide('b', 'image'), slide('p', 'text', { partsMode: true })];
  assert.equal(filteredEditorSlides(slides, false), slides);
  assert.deepEqual(filteredEditorSlides(slides, true).map(s => s.id), ['a', 'v', 'b']);
  assert.equal(editorFilterTarget(slides, 'v', true)?.id, 'v');
  assert.equal(editorFilterTarget(slides, 'p', true)?.id, 'b');
  assert.equal(editorFilterTarget([slides[3]], 'p', true), undefined);
});

test('every special type can be visited without drafts, mutations or save changes', () => {
  const specials: Slide[] = ['loop', 'screen', 'countdown', 'captions'].map((type, i) => slide(String(i), type as Slide['type']));
  specials.push(slide('parts', 'text', { partsMode: true, parts: ['verse'] }));
  for (const special of specials) {
    assert.equal(isItemEditableSlide(special), false);
    let state = createEditorHistory(special);
    assert.equal(state.session.drafts.size, 0);
    state = editorDeckReducer(state, { type: 'activate', slide: special, order: [special.id] });
    assert.equal(state.session.activeId, special.id);
    assert.equal(state.session.drafts.size, 0);
    const original = state;
    state = editorDeckReducer(state, { type: 'mutateSlide', slide: special, history: true, mutate: d => ({ ...d, gridSize: 20 }) });
    assert.equal(state, original);
    state = editorDeckReducer(state, { type: 'pasteIntoActive', slide: special, clipboardItems: createDraft(slide('a')).items, exact: false, sourceSlideId: null });
    assert.equal(state, original);
    const deck: Presentation = { id: 'd', name: 'Test', slides: [special] };
    assert.equal(applyDraftsToDeck(deck, new Map([[special.id, createDraft(special)]])), null);
  }
});

test('visiting a special slide preserves dirty draft, item selection and undo history', () => {
  const a = slide('a'); const v = slide('v', 'screen');
  let state = createEditorHistory(a);
  state = editorDeckReducer(state, { type: 'mutateSlide', slide: a, history: true, mutate: d => ({ ...d, gridSize: 30 }) });
  const id = state.session.drafts.get('a')!.items[0].id;
  state = editorDeckReducer(state, { type: 'setItemSelection', slideId: 'a', ids: [id] });
  state = editorDeckReducer(state, { type: 'activate', slide: v, order: ['a', 'v'] });
  assert.equal(state.past.length, 1);
  assert.equal(state.session.drafts.has('v'), false);
  state = editorDeckReducer(state, { type: 'activate', slide: a, order: ['a', 'v'] });
  assert.equal(state.session.drafts.get('a')!.gridSize, 30);
  assert.deepEqual(state.session.itemSelection.get('a'), [id]);
  assert.deepEqual([...state.session.touchedIds], ['a']);
});

