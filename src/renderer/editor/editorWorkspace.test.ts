import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Presentation, Slide } from '../types';
import { findEditorConflicts, mergeEditorCommit } from './editorConflicts';
import { createEditorHistory, editorDeckReducer } from './useEditorDeck';
import { guardEditorReplacement, registerEditorGuard } from './editorSessionGuard';
import { undoReducer } from '../state/undoReducer';

const slide = (id: string, content = id): Slide => ({ id, content, type: 'text' });
const deck = (slides: Slide[]): Presentation => ({ id: 'deck', name: 'Test', slides });

test('conflicts only include touched existing slides whose source changed', () => {
  const a = slide('a');
  const b = slide('b');
  const bases = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  assert.deepEqual(findEditorConflicts(deck([JSON.parse(JSON.stringify(a)), b]), bases, new Set(['a'])), []);
  assert.deepEqual(findEditorConflicts(deck([slide('a', 'external'), slide('b', 'external')]), bases, new Set(['a'])), [
    'a',
  ]);
  assert.deepEqual(findEditorConflicts(deck([b]), bases, new Set(['a'])), []);
});

test('one commit preserves latest order and metadata without resurrecting deleted slides', () => {
  const latest = deck([slide('b'), slide('a')]);
  const next = mergeEditorCommit(latest, [slide('a', 'edited'), slide('deleted')]);
  assert.deepEqual(
    next.slides.map((s) => s.id),
    ['b', 'a']
  );
  assert.equal(next.slides[0], latest.slides[0]);
  const initial = { past: [], present: latest, future: [] };
  const saved = undoReducer(initial, { type: 'SET', payload: next });
  assert.equal(saved.past.length, 1);
  assert.deepEqual(undoReducer(saved, { type: 'UNDO' }).present.slides, latest.slides);
});

test('reset after save or discard clears local history and uses latest slide version', () => {
  const a = slide('a');
  let state = createEditorHistory(a);
  state = editorDeckReducer(state, {
    type: 'mutateSlide',
    slide: a,
    history: true,
    mutate: (draft) => ({ ...draft, gridSize: 25 }),
  });
  assert.equal(state.session.touchedIds.size, 1);
  const latest = deck([slide('a', 'saved')]);
  state = editorDeckReducer(state, { type: 'reset', deck: latest, activeId: 'a' });
  assert.equal(state.session.touchedIds.size, 0);
  assert.equal(state.past.length, 0);
  assert.equal(state.future.length, 0);
  assert.equal(state.session.drafts.get('a')?.items[0].content, 'saved');
});

test('external synchronization refreshes clean drafts while retaining dirty drafts and history', () => {
  const a = slide('a');
  const b = slide('b');
  let state = createEditorHistory(a);
  state = editorDeckReducer(state, { type: 'ensure', slide: b });
  state = editorDeckReducer(state, {
    type: 'mutateSlide',
    slide: a,
    history: true,
    mutate: (draft) => ({ ...draft, gridSize: 25 }),
  });
  const dirty = state.session.drafts.get('a');
  state = editorDeckReducer(state, {
    type: 'sync',
    deck: deck([slide('a', 'outside'), slide('b', 'updated')]),
    changedIds: new Set(['a', 'b']),
  });
  assert.equal(state.session.drafts.get('a'), dirty);
  assert.equal(state.session.drafts.get('b')?.items[0].content, 'updated');
  assert.equal(state.past.length, 1);
  state = editorDeckReducer(state, { type: 'sync', deck: deck([b]), changedIds: new Set() });
  assert.equal(state.session.touchedIds.size, 0);
  assert.equal(state.session.drafts.has('a'), false);
  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.drafts.has('a'), false);
});

test('empty deck can start and reset an editor session', () => {
  const state = editorDeckReducer(createEditorHistory(), { type: 'reset', deck: deck([]), activeId: '' });
  assert.equal(state.session.drafts.size, 0);
  assert.equal(state.session.activeId, '');
});

test('materializing a navigation draft preserves its displayed legacy item IDs for the first edit', () => {
  const a = slide('a');
  const b = slide('b');
  let state = editorDeckReducer(createEditorHistory(a), { type: 'navigate', order: ['a', 'b'], delta: 1 });
  const displayed = createEditorHistory(b).session.drafts.get('b')!;
  const id = displayed.items[0].id;
  state = editorDeckReducer(state, { type: 'ensure', slide: b, draft: displayed });
  state = editorDeckReducer(state, {
    type: 'mutateSlide',
    slide: b,
    history: true,
    mutate: (draft) => ({
      ...draft,
      items: draft.items.map((item) => (item.id === id ? { ...item, content: 'First edit' } : item)),
    }),
  });
  assert.equal(state.session.drafts.get('b')?.items[0].id, id);
  assert.equal(state.session.drafts.get('b')?.items[0].content, 'First edit');
});

test('replacement guard cancels safely, prevents overlapping requests and unregisters', async () => {
  let resolve!: (allow: boolean) => void;
  const unregister = registerEditorGuard(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      })
  );
  const first = guardEditorReplacement();
  assert.equal(await guardEditorReplacement(), false);
  resolve(false);
  assert.equal(await first, false);
  unregister();
  assert.equal(await guardEditorReplacement(), true);
  const dispose = registerEditorGuard(async () => true);
  assert.equal(await guardEditorReplacement(), true);
  dispose();
});
