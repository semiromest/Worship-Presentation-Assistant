import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Presentation, Slide } from '../types';
import { createEditorHistory, editorDeckReducer } from './useEditorDeck';
import { applyDraftsToDeck } from './slideDraft';
import { findEditorConflicts } from './editorConflicts';
import { computePatch, applyProjectorPatch, undoReducer } from '../state/undoReducer';

const video: Slide = { id: 'v', type: 'video', content: '', mediaUrl: 'local-resource://media/a.mp4' };
const sibling: Slide = { ...video, id: 'v2' };
const deck: Presentation = { id: 'd', name: 'Test', slides: [video, sibling] };

test('video edits save metadata only, serialize and undo as one deck commit', () => {
  const initial = createEditorHistory(video);
  const settings = { startSeconds: 10, endSeconds: 20, loop: false, muted: true, playbackRate: 2, volume: 0.4 };
  let state = editorDeckReducer(initial, { type: 'videoPlayback', slide: video, settings });
  assert.equal(state.session.drafts.get('v')!.items.length, 0);
  state = editorDeckReducer(state, { type: 'activate', slide: sibling, order: ['v', 'v2'] });
  assert.deepEqual(state.session.drafts.get('v')!.videoPlayback, settings);
  const touched = new Map([...state.session.drafts].filter(([id]) => state.session.touchedIds.has(id)));
  const saved = applyDraftsToDeck(deck, touched)!;
  assert.equal(saved.slides[0].mediaUrl, video.mediaUrl);
  assert.equal(saved.slides[0].items, undefined);
  assert.equal(saved.slides[1], sibling);
  const delta = computePatch(deck, saved);
  assert.deepEqual(applyProjectorPatch(deck, delta).slides[0].videoPlayback, settings);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)).slides[0].videoPlayback, settings);
  const history = undoReducer({ past: [], present: deck, future: [] }, { type: 'SET', payload: saved });
  assert.equal(history.past.length, 1);
  assert.deepEqual(undoReducer(history, { type: 'UNDO' }).present.slides, deck.slides);
  assert.equal(editorDeckReducer(state, { type: 'undo' }).session.touchedIds.size, 0);
});

test('video conflicts and deletion use the same editor guards as other drafts', () => {
  const state = editorDeckReducer(createEditorHistory(video), { type: 'videoPlayback', slide: video, settings: { muted: true } });
  const modified = { ...deck, slides: [{ ...video, videoPlayback: { loop: false } }, sibling] };
  assert.deepEqual(findEditorConflicts(modified, new Map([['v', video]]), state.session.touchedIds), ['v']);
  assert.equal(applyDraftsToDeck({ ...deck, slides: [sibling] }, new Map([['v', state.session.drafts.get('v')!]])), null);
  assert.equal(editorDeckReducer(state, { type: 'reset', deck: modified, activeId: 'v' }).past.length, 0);
});
