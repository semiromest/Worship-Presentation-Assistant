import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Presentation, Slide, SlideItem } from '../types';
import { applyDraftsToDeck, createDraft, pasteItems, type SlideDraft } from './slideDraft';
import { normalizeSections } from '../../shared/sectionModel';
import { undoReducer, type UndoState } from '../state/undoReducer';
import { DEFAULT_TEXT_STYLE } from './editorUtils';

/**
 * The editor hands the deck a single SET of every touched slide. These tests
 * drive that payload through the real deck reducer so the multi-slide undo
 * contract is verified at the seam, not just inside the editor.
 */

const slide = (id: string, content: string, extra: Partial<Slide> = {}): Slide => ({
  id,
  type: 'text',
  content,
  styles: { fontSize: 40, backgroundColor: '#000', textColor: '#fff' },
  ...extra,
});

/** The store always holds a section-normalised deck; the fixtures match it. */
const deck = (): Presentation =>
  normalizeSections({
    id: 'deck',
    name: 'Pazar',
    slides: [slide('a', 'Bir'), slide('b', 'İki'), slide('c', 'Üç')],
    transition: { type: 'fade', duration: 300 },
  });

const item = (id: string, content: string): SlideItem => ({
  id,
  type: 'text',
  content,
  x: 10,
  y: 10,
  width: 40,
  height: 20,
  zIndex: 0,
  visible: true,
  locked: false,
  styles: {},
  textStyles: { ...DEFAULT_TEXT_STYLE },
});

/** Mirrors the store: SET payloads are section-normalised before the reducer. */
const commit = (state: UndoState, next: Presentation): UndoState =>
  undoReducer(state, { type: 'SET', payload: normalizeSections(next) });

test('editing two slides is one deck undo step that restores both', () => {
  const original = deck();
  let state: UndoState = { past: [], present: original, future: [] };

  const drafts = new Map<string, SlideDraft>();
  const draftB = createDraft(original.slides[1]);
  drafts.set('b', {
    ...draftB,
    items: draftB.items.map((entry) => ({ ...entry, content: 'İki (düzeltildi)' })),
  });
  const draftC = createDraft(original.slides[2]);
  drafts.set('c', { ...draftC, gridEnabled: true });

  const next = applyDraftsToDeck(original, drafts);
  assert.ok(next);
  state = commit(state, next!);

  assert.equal(state.past.length, 1, 'one entry for the whole editing session');
  assert.equal(state.present.slides[1].content, 'İki (düzeltildi)');
  assert.equal(state.present.slides[2].gridEnabled, true);
  assert.equal(state.present.slides[0], original.slides[0], 'untouched slide keeps its identity');

  state = undoReducer(state, { type: 'UNDO' });
  assert.equal(state.present.slides[1].content, 'İki');
  assert.equal(state.present.slides[2].gridEnabled, undefined);
  assert.equal(state.present.slides[2], original.slides[2], 'undo restores the original objects');

  state = undoReducer(state, { type: 'REDO' });
  assert.equal(state.present.slides[1].content, 'İki (düzeltildi)');
  assert.equal(state.present.slides[2].gridEnabled, true);
});

test('applying one element to many slides is a single undoable step', () => {
  const original = deck();
  let state: UndoState = { past: [], present: original, future: [] };

  const logo = item('logo', ''); // media item stand-in: identity is what matters here
  const drafts = new Map<string, SlideDraft>();
  for (const target of original.slides) {
    const draft = createDraft(target);
    drafts.set(target.id, {
      ...draft,
      items: pasteItems(draft.items, [logo], { offset: false }).items,
    });
  }

  const next = applyDraftsToDeck(original, drafts);
  state = commit(state, next!);

  assert.equal(state.past.length, 1);
  for (const edited of state.present.slides) {
    assert.ok(edited.items?.some((entry) => entry.content === ''));
  }

  state = undoReducer(state, { type: 'UNDO' });
  for (let i = 0; i < original.slides.length; i++) {
    assert.equal(state.present.slides[i], original.slides[i], 'undo clears every slide at once');
  }
});

test('merely visiting slides never rewrites them', () => {
  const original = deck();

  // Opening the editor materialises a working copy of the entry slide and of
  // every slide visited afterwards, but only edited slides reach the payload.
  const visited = new Map<string, SlideDraft>([
    ['a', createDraft(original.slides[0])],
    ['b', createDraft(original.slides[1])],
  ]);
  const touchedIds = new Set<string>();

  const touched = new Map([...visited].filter(([id]) => touchedIds.has(id)));
  assert.equal(applyDraftsToDeck(original, touched), null, 'nothing to commit');

  // Editing one of them commits exactly one slide.
  const edited = visited.get('b')!;
  touchedIds.add('b');
  const payload = applyDraftsToDeck(
    original,
    new Map([...visited].filter(([id]) => touchedIds.has(id))),
  );
  assert.ok(payload);
  assert.equal(payload!.slides[0], original.slides[0], 'visited-but-untouched slide a is passed through');
  assert.equal(payload!.slides[2], original.slides[2], 'untouched slide c is passed through');
  assert.notEqual(payload!.slides[1], original.slides[1], 'only the edited slide is rebuilt');
  assert.ok(edited.items.length > 0);
});

test('a deck still missing from the working set is not resurrected by the commit', () => {
  const original = deck();
  const drafts = new Map<string, SlideDraft>([['gone', createDraft(slide('gone', 'x'))]]);
  // A slide deleted elsewhere while the editor was open cannot come back.
  assert.equal(applyDraftsToDeck(original, drafts), null);
});
