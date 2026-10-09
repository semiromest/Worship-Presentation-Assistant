import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newVideoOverlay, overlayVisible } from './videoOverlays';
import type { Presentation, Slide } from './types';
import { createEditorHistory, editorDeckReducer } from './editor/useEditorDeck';
import { applyDraftsToDeck } from './editor/slideDraft';
import { computePatch, applyProjectorPatch, undoReducer } from './state/undoReducer';
import { findEditorConflicts } from './editor/editorConflicts';

test('overlay timing follows original media time and repeats naturally after a loop seek', () => {
  const item = newVideoOverlay('text', 'Dikmen, Hürriyet Cd.', 0);
  assert.equal(overlayVisible(item, 0), true);
  const timed = { ...item, startSeconds: 5, endSeconds: 10 };
  assert.equal(overlayVisible(timed, 4.99), false);
  assert.equal(overlayVisible(timed, 5), true);
  assert.equal(overlayVisible(timed, 10), false);
  assert.equal(overlayVisible(timed, 5), true);
  assert.equal(overlayVisible({ ...timed, visible: false }, 7), false);
});

test('video overlays save independently of legacy items and source; deck undo and projector delta retain them', () => {
  const slide: Slide = { id: 'video', type: 'video', content: '', mediaUrl: 'local-resource://media/a.mp4', items: [] };
  const sibling: Slide = { ...slide, id: 'sibling' };
  const deck: Presentation = { id: 'deck', name: 'Deck', slides: [slide, sibling] };
  const overlays = [newVideoOverlay('text', 'Caption', 0)];
  const state = editorDeckReducer(createEditorHistory(slide), { type: 'videoOverlays', slide, overlays });
  const saved = applyDraftsToDeck(deck, state.session.drafts)!;
  assert.equal(saved.slides[0].mediaUrl, slide.mediaUrl);
  assert.equal(saved.slides[0].items, slide.items);
  assert.equal(saved.slides[1], sibling);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)).slides[0].videoOverlays, overlays);
  assert.deepEqual(applyProjectorPatch(deck, computePatch(deck, saved)).slides[0].videoOverlays, overlays);
  const history = undoReducer({ past: [], present: deck, future: [] }, { type: 'SET', payload: saved });
  assert.deepEqual(undoReducer(history, { type: 'UNDO' }).present.slides, deck.slides);
  assert.deepEqual(
    findEditorConflicts(
      { ...deck, slides: [{ ...slide, videoOverlays: [{ ...overlays[0], content: 'External' }] }, sibling] },
      new Map([['video', slide]]),
      state.session.touchedIds
    ),
    ['video']
  );
  assert.equal(
    applyDraftsToDeck({ ...deck, slides: [sibling] }, new Map([['video', state.session.drafts.get('video')!]])),
    null
  );
});

test('overlay gestures are one undo step and readonly slides reject overlay mutations', () => {
  const slide: Slide = { id: 'video', type: 'video', content: '' };
  const item = newVideoOverlay('text', 'Caption', 0);
  let state = editorDeckReducer(createEditorHistory(slide), { type: 'videoOverlays', slide, overlays: [item] });
  state = editorDeckReducer(state, { type: 'gestureStart' });
  state = editorDeckReducer(state, { type: 'videoOverlays', slide, overlays: [{ ...item, x: 20 }], history: false });
  state = editorDeckReducer(state, { type: 'videoOverlays', slide, overlays: [{ ...item, x: 30 }], history: false });
  state = editorDeckReducer(state, { type: 'gestureEnd' });
  assert.equal(state.past.length, 2);
  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.drafts.get('video')!.videoOverlays![0].x, 10);
  const readonly: Slide = { ...slide, type: 'loop' };
  const initial = createEditorHistory(readonly);
  assert.equal(editorDeckReducer(initial, { type: 'videoOverlays', slide: readonly, overlays: [item] }), initial);
});
