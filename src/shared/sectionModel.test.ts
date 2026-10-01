import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import {
  normalizeSections,
  createSectionAt,
  createSectionFromSelection,
  selectedSlideIds,
  getSectionBlocks,
  sectionInsertionPoints,
  insertionPointForSlide,
  insertEmptySection,
  moveSlidesToSection,
  moveSectionTo,
  removeSection,
  updateSection,
  moveSectionSlidesOneStep,
  UNASSIGNED_DESTINATION,
} from './sectionModel';
import { computePatch, applyProjectorPatch, undoReducer, isPatchEmpty } from '../renderer/state/undoReducer';
import { resolveLiveSlidePosition } from '../renderer/slideLock';
import type { Presentation, Slide } from '../renderer/types';
const ids = (deck: Presentation) => deck.slides.map((s) => s.id);
const base = (): Presentation =>
  normalizeSections({
    id: 'deck',
    name: 'Sunday',
    zoom: 1,
    transition: { type: 'none', duration: 400 },
    slides: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, type: 'text', content: id })),
  });
function divided() {
  const first = createSectionAt(base(), 'a', { id: 'intro', title: 'Giriş' });
  const second = createSectionAt(first, 'c', { id: 'worship', title: 'İbadet' });
  return createSectionAt(second, 'e', { id: 'end', title: 'Kapanış' });
}
test('legacy migration preserves order, separates disjoint IDs, and is idempotent', () => {
  const slides: Slide[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id,
    type: 'text',
    content: id,
    section: i === 1 ? undefined : { id: 'worship', title: 'Özel İsim' },
  }));
  const result = normalizeSections({ name: 'old', slides });
  assert.deepEqual(ids(result), ['a', 'b', 'c', 'd']);
  assert.equal(result.sections?.length, 3);
  assert.notEqual(result.slides[0].sectionId, result.slides[2].sectionId);
  assert.equal(result.slides[2].sectionId, result.slides[3].sectionId);
  assert.equal(result.sections?.[2].title, 'Özel İsim');
  assert.equal(normalizeSections(result), result);
  assert.deepEqual(normalizeSections({ name: 'old', slides }), result);
});
test('split takes only the current suffix, keeps later sections and order', () => {
  const before = divided();
  const after = createSectionAt(before, 'd', { id: 'custom', title: 'Rabbin Sofrası' });
  assert.deepEqual(ids(after), ids(before));
  assert.deepEqual(
    getSectionBlocks(after).map((b) => [b.title, b.slides.map((s) => s.id)]),
    [
      ['Giriş', ['a', 'b']],
      ['İbadet', ['c']],
      ['Rabbin Sofrası', ['d']],
      ['Kapanış', ['e', 'f']],
    ]
  );
  assert.equal(createSectionAt(after, 'c', { id: 'bad', title: 'New' }), after);
});
test('insertion points cover every real split and carry the claimable slide count', () => {
  const deck = createSectionAt(base(), 'a', { id: 'one', title: 'Tek' });
  const points = sectionInsertionPoints(deck);
  assert.deepEqual(
    points.map((p) => p.beforeSlideId ?? 'end'),
    ['b', 'c', 'd', 'e', 'f', 'end']
  );
  assert.deepEqual(
    points.map((p) => p.slideCount),
    [5, 4, 3, 2, 1, 0]
  );
  for (const point of points) {
    if (!point.beforeSlideId) {
      assert.equal(point.atEnd, true);
      continue;
    }
    const next = createSectionAt(deck, point.beforeSlideId, { id: 'new:' + point.beforeSlideId, title: 'Yeni' });
    assert.notEqual(next, deck);
    assert.deepEqual(ids(next), ids(deck));
    assert.equal(next.slides.find((s) => s.id === point.beforeSlideId)!.sectionId, 'new:' + point.beforeSlideId);
    assert.equal(
      getSectionBlocks(next).find((b) => b.id === 'new:' + point.beforeSlideId)!.slides.length,
      point.slideCount
    );
  }
});
test('named section heads are not offered as split points while unassigned runs are', () => {
  assert.deepEqual(
    sectionInsertionPoints(divided()).map((p) => p.beforeSlideId ?? 'end'),
    ['b', 'd', 'f', 'end']
  );
  const raw = normalizeSections({
    name: 'raw',
    slides: ['a', 'b', 'c'].map((id) => ({ id, type: 'text' as const, content: id })),
  });
  assert.deepEqual(
    sectionInsertionPoints(raw).map((p) => p.beforeSlideId ?? 'end'),
    ['a', 'b', 'c', 'end']
  );
  const named = createSectionAt(raw, 'a', { id: 'intro', title: 'Giriş' });
  assert.deepEqual(
    sectionInsertionPoints(named).map((p) => p.beforeSlideId ?? 'end'),
    ['b', 'c', 'end']
  );
  assert.equal(insertEmptySection(divided(), undefined, { id: 'tail', title: 'Kapanış 2' }).sections?.length, 4);
});
test('selection grouping takes exactly the chosen slides and keeps their order', () => {
  const deck = base();
  const next = createSectionFromSelection(deck, new Set(['c', 'd']), { id: 'sermon', title: 'Vaaz' });
  // Playback order of every slide is untouched.
  assert.deepEqual(ids(next), ids(deck));
  assert.deepEqual(
    getSectionBlocks(next).map((b) => [b.id, b.slides.map((s) => s.id)]),
    [
      ['__unassigned', ['a', 'b']],
      ['sermon', ['c', 'd']],
      ['__unassigned~e', ['e', 'f']],
    ]
  );
  assert.deepEqual(selectedSlideIds(deck, new Set(['f', 'b'])), ['b', 'f']);
});

test('non-adjacent picks are gathered at the first chosen slide without reordering the rest', () => {
  const deck = base();
  const next = createSectionFromSelection(deck, new Set(['a', 'd', 'f']), { id: 'pick', title: 'Seçim' });
  assert.deepEqual(
    getSectionBlocks(next).map((b) => [b.id, b.slides.map((s) => s.id)]),
    [
      ['pick', ['a', 'd', 'f']],
      ['__unassigned', ['b', 'c', 'e']],
    ]
  );
  // Every unselected slide keeps its relative order, and no slide is lost.
  assert.deepEqual(
    ids(next).filter((id) => !['a', 'd', 'f'].includes(id)),
    ['b', 'c', 'e']
  );
});

test('choosing a whole existing section renames it in place instead of orphaning it', () => {
  const deck = divided();
  const next = createSectionFromSelection(deck, new Set(['a', 'b']), { id: 'renamed', title: 'Açılış' });
  assert.deepEqual(
    getSectionBlocks(next).map((b) => [b.id, b.slides.map((s) => s.id)]),
    [
      ['renamed', ['a', 'b']],
      ['worship', ['c', 'd']],
      ['end', ['e', 'f']],
    ]
  );
  assert.equal(createSectionFromSelection(deck, new Set(), { id: 'x', title: 'X' }), deck);
  assert.equal(createSectionFromSelection(deck, new Set(['a']), { id: 'y', title: '  ' }), deck);
});

test('toolbar insertion point lands on the selection or the next boundary below it', () => {
  const deck = divided();
  assert.equal(insertionPointForSlide(deck, 'b').beforeSlideId, 'b');
  // 'c' already starts a named section, so the next real boundary is 'd'.
  assert.equal(insertionPointForSlide(deck, 'c').beforeSlideId, 'd');
  assert.equal(insertionPointForSlide(deck, 'e').beforeSlideId, 'f');
  assert.equal(insertionPointForSlide(deck, 'f').beforeSlideId, 'f');
  assert.equal(insertionPointForSlide(deck, 'missing').atEnd, true);
  assert.equal(insertionPointForSlide(deck, 'a').beforeSlideId, 'b');
});
test('duplicate names remain independent and rename updates compatibility snapshots', () => {
  const deck = createSectionAt(divided(), 'b', { id: 'repeat', title: 'Giriş' });
  const next = updateSection(deck, 'intro', { title: 'Opening', color: '#34d399', icon: '♫' });
  assert.equal(next.sections?.find((s) => s.id === 'repeat')?.title, 'Giriş');
  assert.equal(next.slides[0].section?.title, 'Opening');
  assert.equal(updateSection(next, 'intro', { title: '  ' }), next);
});
test('non-adjacent selection moves in playback order and source sections can remain empty', () => {
  const moved = moveSlidesToSection(divided(), new Set(['d', 'b', 'c']), 'end', 'start');
  assert.deepEqual(ids(moved), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(
    getSectionBlocks(moved).map((b) => b.slides.map((s) => s.id)),
    [['a'], [], ['b', 'c', 'd', 'e', 'f']]
  );
  assert.equal(moved.sections?.[1].id, 'worship');
  assert.deepEqual(normalizeSections(JSON.parse(JSON.stringify(moved))), moved);
});
test('drop before a slide and at section end adopt membership and maintain order', () => {
  const moved = moveSlidesToSection(divided(), new Set(['b']), 'worship', { beforeId: 'd' });
  assert.deepEqual(ids(moved), ['a', 'c', 'b', 'd', 'e', 'f']);
  assert.equal(moved.slides[2].sectionId, 'worship');
  const end = moveSlidesToSection(moved, new Set(['c', 'b']), 'end', 'end');
  assert.deepEqual(ids(end), ['a', 'd', 'e', 'f', 'c', 'b']);
  assert.equal(moveSlidesToSection(end, new Set(['c']), 'end', { beforeId: 'c' }), end);
});
test('empty sections survive round trip and reorder independently', () => {
  const empty = insertEmptySection(divided(), 'worship', { id: 'empty', title: 'Duyurular' });
  assert.deepEqual(
    empty.sections?.map((s) => s.id),
    ['intro', 'empty', 'worship', 'end']
  );
  const moved = moveSectionTo(empty, 'empty', 3);
  assert.deepEqual(
    moved.sections?.map((s) => s.id),
    ['intro', 'worship', 'end', 'empty']
  );
  assert.deepEqual(ids(moved), ids(empty));
  assert.deepEqual(normalizeSections(JSON.parse(JSON.stringify(moved))), moved);
  const filled = moveSlidesToSection(moved, new Set(['c']), 'empty', 'end');
  assert.deepEqual(ids(filled), ['a', 'b', 'd', 'e', 'f', 'c']);
});
test('section reorder moves whole block, including membership, and preserves live identity', () => {
  const moved = moveSectionTo(divided(), 'end', 0);
  assert.deepEqual(ids(moved), ['e', 'f', 'a', 'b', 'c', 'd']);
  assert.equal(resolveLiveSlidePosition('c', 2, moved.slides).index, 4);
  assert.equal(resolveLiveSlidePosition('c', 2, moved.slides).slideId, 'c');
});
test('merge in either direction retains playback order for adjacent blocks', () => {
  for (const [from, to] of [
    ['intro', 'worship'],
    ['worship', 'intro'],
  ]) {
    const merged = removeSection(divided(), from, to);
    assert.deepEqual(ids(merged), ids(divided()));
    assert.equal(merged.sections?.length, 2);
    assert.ok(merged.slides.slice(0, 4).every((s) => s.sectionId === to));
  }
});
test('remove sole section preserves all slides as unassigned; delete protects locked and last slides', () => {
  const deck = createSectionAt(base(), 'a', { id: 'single', title: 'Named' });
  const removed = removeSection(deck, 'single', UNASSIGNED_DESTINATION);
  assert.deepEqual(ids(removed), ids(deck));
  assert.equal(removed.sections?.[0].unassigned, true);
  assert.equal(removeSection(deck, 'single', undefined, true), deck);
  const locked = divided();
  locked.slides[0] = { ...locked.slides[0], locked: true };
  assert.equal(removeSection(locked, 'intro', undefined, true), locked);
  assert.deepEqual(ids(removeSection(divided(), 'intro', undefined, true)), ['c', 'd', 'e', 'f']);
});
test('single and multi up/down commands do not fragment destination sections', () => {
  const down = moveSectionSlidesOneStep(divided(), new Set(['b']), 1);
  assert.deepEqual(ids(down), ['a', 'c', 'b', 'd', 'e', 'f']);
  assert.equal(down.sections?.length, 3);
  assert.equal(down.slides[2].sectionId, 'worship');
  const multi = moveSectionSlidesOneStep(divided(), new Set(['a', 'b']), 1);
  assert.deepEqual(ids(multi), ['c', 'a', 'b', 'd', 'e', 'f']);
  assert.ok(multi.slides.slice(0, 4).every((s) => s.sectionId === 'worship'));
});
test('metadata-only and empty section changes survive undo/redo, patches and JSON saves', () => {
  const original = divided();
  const next = updateSection(insertEmptySection(original, undefined, { id: 'empty', title: 'Later' }), 'intro', {
    title: 'Renamed',
    icon: '♫',
    color: '#60a5fa',
  });
  const state = undoReducer({ present: original, past: [], future: [] }, { type: 'SET', payload: next });
  const undone = undoReducer(state, { type: 'UNDO' });
  assert.deepEqual(undone.present, original);
  assert.deepEqual(undoReducer(undone, { type: 'REDO' }).present, next);
  const patch = computePatch(original, next);
  assert.equal(isPatchEmpty(patch), false);
  assert.deepEqual(
    applyProjectorPatch(original, {
      slidesPatch: patch.slidesPatch,
      nextOrder: patch.nextOrder,
      nextSections: patch.nextSections,
    }),
    next
  );
  assert.deepEqual(normalizeSections(JSON.parse(JSON.stringify(next))), next);
});
test('large decks retain stable records and contiguous blocks after moves', () => {
  const large = normalizeSections({
    name: 'Large',
    slides: Array.from({ length: 5000 }, (_, i) => ({
      id: String(i),
      type: 'text' as const,
      content: String(i),
      section: { id: 's' + Math.floor(i / 50), title: 'Section ' + Math.floor(i / 50) },
    })),
  });
  const start = performance.now();
  const moved = moveSlidesToSection(large, new Set(['4', '5', '49']), 's99', 'end');
  assert.equal(moved.slides.length, 5000);
  assert.equal(new Set(ids(moved)).size, 5000);
  assert.equal(getSectionBlocks(moved).length, 100);
  assert.equal(normalizeSections(moved), moved);
  console.log('5000-slide section move: ' + (performance.now() - start).toFixed(1) + ' ms');
});
