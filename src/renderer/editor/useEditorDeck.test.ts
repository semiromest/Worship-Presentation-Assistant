import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Slide, SlideItem } from '../types';
import { createEditorHistory, editorDeckReducer, EDITOR_HISTORY_LIMIT } from './useEditorDeck';
import { createDraft } from './slideDraft';
import { DEFAULT_TEXT_STYLE } from './editorUtils';

const slide = (overrides: Partial<Slide> = {}): Slide => ({
  id: 's1',
  type: 'text',
  content: 'Bir',
  styles: { fontSize: 40, backgroundColor: '#000', textColor: '#fff' },
  ...overrides,
});

const item = (overrides: Partial<SlideItem> = {}): SlideItem => ({
  id: 'i1',
  type: 'text',
  content: 'Merhaba',
  x: 10,
  y: 10,
  width: 20,
  height: 10,
  zIndex: 0,
  visible: true,
  locked: false,
  textStyles: { ...DEFAULT_TEXT_STYLE },
  styles: {},
  ...overrides,
});

test('the entry slide starts with a working copy but is not touched', () => {
  const state = createEditorHistory(slide());
  assert.ok(state.session.drafts.get('s1'), 'working copy materialised up front');
  assert.equal(state.session.touchedIds.size, 0, 'visiting a slide must not mark it edited');
  assert.deepEqual(state.session.selection.selectedIds, ['s1']);
  assert.equal(state.past.length, 0);
  assert.equal(state.gestureBase, null);
});

test('pasting into the active slide adds a copy, selects it and is undoable', () => {
  const slideOne = slide({ items: [item({ id: 'existing' })] });
  let state = createEditorHistory(slideOne);

  state = editorDeckReducer(state, {
    type: 'pasteIntoActive',
    slide: slideOne,
    clipboardItems: [item({ id: 'copied', x: 50, y: 50 })],
    sourceSlideId: 'other-slide',
    exact: false,
  });

  const items = state.session.drafts.get('s1')!.items;
  assert.equal(items.length, 2);
  const pasted = items.find((candidate) => candidate.id !== 'existing');
  assert.ok(pasted);
  assert.equal(pasted.x, 50, 'cross-slide paste keeps the exact position');
  assert.deepEqual(state.session.itemSelection.get('s1'), [pasted.id]);
  assert.equal(state.session.touchedIds.has('s1'), true);

  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.drafts.get('s1')!.items.length, 1);
  assert.deepEqual(state.session.itemSelection.get('s1'), undefined);
});

test('pasting back onto the source slide offsets the copy', () => {
  const slideOne = slide({ items: [item({ id: 'existing', x: 10, y: 10 })] });
  let state = createEditorHistory(slideOne);
  state = editorDeckReducer(state, {
    type: 'pasteIntoActive',
    slide: slideOne,
    clipboardItems: [item({ id: 'copied', x: 10, y: 10 })],
    sourceSlideId: 's1',
    exact: false,
  });
  const pasted = state.session.drafts.get('s1')!.items.find((candidate) => candidate.id !== 'existing');
  assert.equal(pasted?.x, 12);
  assert.equal(pasted?.y, 12);
});

const dragFrame = (slideOne: Slide, x: number) => ({
  type: 'mutateSlide' as const,
  slide: slideOne,
  history: false,
  mutate: (draft: import('./slideDraft').SlideDraft) => ({
    ...draft,
    items: draft.items.map((candidate) => (candidate.id === 'a' ? { ...candidate, x } : candidate)),
  }),
});

test('a drag gesture collapses into exactly one undo step that returns to the start position', () => {
  const slideOne = slide({ items: [item({ id: 'a', x: 10, y: 10 })] });
  let state = createEditorHistory(slideOne);

  state = editorDeckReducer(state, { type: 'gestureStart' });
  assert.equal(state.past.length, 0, 'starting a gesture records nothing yet');
  for (const x of [11, 12, 13]) state = editorDeckReducer(state, dragFrame(slideOne, x));
  state = editorDeckReducer(state, { type: 'gestureEnd' });

  assert.equal(state.past.length, 1, 'the whole gesture is one history entry');
  assert.equal(state.session.drafts.get('s1')!.items[0].x, 13);

  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.drafts.get('s1')!.items[0].x, 10, 'undo returns to the pre-drag position');

  state = editorDeckReducer(state, { type: 'redo' });
  assert.equal(state.session.drafts.get('s1')!.items[0].x, 13);
});

test('a gesture that changes nothing leaves no undo entry behind', () => {
  const slideOne = slide({ items: [item({ id: 'a' })] });
  let state = createEditorHistory(slideOne);
  state = editorDeckReducer(state, { type: 'gestureStart' });
  state = editorDeckReducer(state, { type: 'gestureEnd' });
  assert.equal(state.past.length, 0);
  assert.equal(state.gestureBase, null);
});

test('the gesture base is consumed once and later edits record their own entry', () => {
  const slideOne = slide({ items: [item({ id: 'a', x: 10, y: 10 })] });
  let state = createEditorHistory(slideOne);

  state = editorDeckReducer(state, { type: 'gestureStart' });
  state = editorDeckReducer(state, dragFrame(slideOne, 30));
  state = editorDeckReducer(state, { type: 'gestureEnd' });
  // A discrete edit after the gesture must be its own undo step.
  state = editorDeckReducer(state, {
    type: 'mutateSlide',
    slide: slideOne,
    history: true,
    mutate: (draft) => ({ ...draft, gridSize: 25 }),
  });

  assert.equal(state.past.length, 2);
  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.drafts.get('s1')!.gridSize, 10, 'the grid edit is undone');
  assert.equal(state.session.drafts.get('s1')!.items[0].x, 30, 'the drag stays applied');
  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.drafts.get('s1')!.items[0].x, 10);
});

test('bulk edits mark every applied slide as touched and clear on undo', () => {
  const slides = [slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })];
  let state = createEditorHistory(slides[0]);

  const drafts = new Map(state.session.drafts);
  for (const target of [slides[1], slides[2]]) {
    drafts.set(target.id, { ...createDraft(target), gridEnabled: true });
  }

  state = editorDeckReducer(state, {
    type: 'bulk',
    drafts,
    touched: ['b', 'c'],
    notice: { key: 'common.editorAppliedToSlides', count: 2, tone: 'info' },
  });

  assert.deepEqual([...state.session.touchedIds].sort(), ['b', 'c']);
  assert.equal(state.session.notice?.count, 2);
  assert.equal(state.past.length, 1, 'one history entry for the whole bulk operation');

  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.touchedIds.size, 0);
  assert.equal(state.session.drafts.has('b'), false);
  assert.equal(state.session.notice, null, 'a stale success notice never survives undo');
});

test('a no-op bulk action only surfaces its notice', () => {
  const start = createEditorHistory(slide());
  const state = editorDeckReducer(start, {
    type: 'bulk',
    drafts: start.session.drafts,
    touched: [],
    notice: { key: 'common.editorApplySkipped', count: 1, tone: 'warn' },
  });

  assert.equal(state.past.length, 0, 'nothing changed, so nothing to undo');
  assert.equal(state.session.notice?.tone, 'warn');
});

test('undo history is capped and redo is cleared by a new edit', () => {
  const slideOne = slide({ items: [item({ id: 'a' })] });
  let state = createEditorHistory(slideOne);

  for (let i = 0; i < EDITOR_HISTORY_LIMIT + 25; i++) {
    state = editorDeckReducer(state, {
      type: 'mutateSlide',
      slide: slideOne,
      history: true,
      mutate: (draft) => ({ ...draft, gridSize: i + 1 }),
    });
  }
  assert.equal(state.past.length, EDITOR_HISTORY_LIMIT);

  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.future.length, 1);

  state = editorDeckReducer(state, {
    type: 'mutateSlide',
    slide: slideOne,
    history: true,
    mutate: (draft) => ({ ...draft, gridSize: 999 }),
  });
  assert.equal(state.future.length, 0, 'a new edit discards the redo branch');
});

test('slide activation keeps drafts of other slides intact', () => {
  const slides = [slide({ id: 'a' }), slide({ id: 'b' })];
  let state = createEditorHistory(slides[0]);
  state = editorDeckReducer(state, { type: 'activate', slide: slides[1], order: ['a', 'b'] });
  assert.equal(state.session.activeId, 'b');
  assert.ok(state.session.drafts.has('a'), 'the slide already visited keeps its working copy');

  state = editorDeckReducer(state, { type: 'setItemSelection', slideId: 'a', ids: ['i1'] });
  state = editorDeckReducer(state, { type: 'activate', slide: slides[0], order: ['a', 'b'] });
  assert.deepEqual(state.session.itemSelection.get('a'), ['i1'], 'item selection memory is per slide');
});

test('a mutate action that changes nothing is a true no-op', () => {
  const slideOne = slide();
  const start = createEditorHistory(slideOne);
  const state = editorDeckReducer(start, {
    type: 'mutateSlide',
    slide: slideOne,
    history: true,
    mutate: () => null,
  });
  assert.equal(state, start);
});
