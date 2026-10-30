import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSections } from './sectionModel';
import { insertionAtCard, moveSlidesAtInsertion } from './slideInsertion';
import { dropSide } from '../renderer/hooks/slideDropGeometry';
import type { Presentation } from './presentation';

const base = () => normalizeSections({ id: 'd', name: 'Deck', slides: ['a','b','c','d','e','f'].map(id => ({ id, type: 'text', content: id })) } as Presentation);
const ids = (deck: Presentation) => deck.slides.map(slide => slide.id);

test('both sides of a gap are equivalent regardless of visual row boundaries', () => {
  const deck = base();
  assert.deepEqual(insertionAtCard(deck, 'c', 'after'), insertionAtCard(deck, 'd', 'before'));
  for (const source of ['a','b','e','f']) {
    assert.deepEqual(ids(moveSlidesAtInsertion(deck, new Set([source]), insertionAtCard(deck, 'c', 'after')!)),
      ids(moveSlidesAtInsertion(deck, new Set([source]), insertionAtCard(deck, 'd', 'before')!)));
  }
});
test('adjacent moves work both ways and unchanged gaps preserve object identity', () => {
  const deck = base();
  assert.equal(moveSlidesAtInsertion(deck, new Set(['a']), insertionAtCard(deck, 'b', 'before')!), deck);
  assert.deepEqual(ids(moveSlidesAtInsertion(deck, new Set(['a']), insertionAtCard(deck, 'b', 'after')!)), ['b','a','c','d','e','f']);
  assert.deepEqual(ids(moveSlidesAtInsertion(deck, new Set(['b']), insertionAtCard(deck, 'a', 'before')!)), ['b','a','c','d','e','f']);
  assert.equal(moveSlidesAtInsertion(deck, new Set(['b']), insertionAtCard(deck, 'a', 'after')!), deck);
});
test('first and last gaps and nonadjacent block order are deterministic', () => {
  const deck = base();
  assert.deepEqual(ids(moveSlidesAtInsertion(deck, new Set(['f','c']), insertionAtCard(deck, 'a', 'before')!)), ['c','f','a','b','d','e']);
  assert.deepEqual(ids(moveSlidesAtInsertion(deck, new Set(['c','a']), insertionAtCard(deck, 'f', 'after')!)), ['b','d','e','f','a','c']);
  assert.equal(moveSlidesAtInsertion(deck, new Set(['e','f']), insertionAtCard(deck, 'f', 'after')!), deck);
});
test('missing targets and deleted moving identities cancel instead of appending', () => {
  const deck = base(), sectionId = deck.slides[0].sectionId!;
  assert.equal(moveSlidesAtInsertion(deck, new Set(['a']), { sectionId, beforeId: 'missing' }), deck);
  assert.equal(moveSlidesAtInsertion(deck, new Set(['missing']), { sectionId, beforeId: null }), deck);
  assert.equal(moveSlidesAtInsertion(deck, new Set(['a']), { sectionId: 'missing', beforeId: null }), deck);
});
test('section boundaries keep destination membership distinct and empty sections accept drops', () => {
  const deck = normalizeSections({ ...base(), sections: [{ id: 'one', title: 'One' }, { id: 'empty', title: 'Empty' }, { id: 'two', title: 'Two' }],
    slides: base().slides.map((slide, i) => ({ ...slide, section: undefined, sectionId: i < 3 ? 'one' : 'two' })) });
  const end = insertionAtCard(deck, 'c', 'after')!, start = insertionAtCard(deck, 'd', 'before')!;
  assert.notDeepEqual(end, start);
  const left = moveSlidesAtInsertion(deck, new Set(['f']), end);
  const right = moveSlidesAtInsertion(deck, new Set(['f']), start);
  assert.deepEqual(ids(left), ids(right));
  assert.equal(left.slides.find(slide => slide.id === 'f')!.sectionId, 'one');
  assert.equal(right.slides.find(slide => slide.id === 'f')!.sectionId, 'two');
  const empty = moveSlidesAtInsertion(deck, new Set(['a']), { sectionId: 'empty', beforeId: null });
  assert.equal(empty.slides.find(slide => slide.id === 'a')!.sectionId, 'empty');
  assert.deepEqual(ids(empty), ['b','c','a','d','e','f']);
});
test('middle dead band stabilizes the indicator but does not trap small cards', () => {
  assert.equal(dropSide(49, 100), 'before');
  assert.equal(dropSide(51, 100, 'before'), 'before');
  assert.equal(dropSide(60, 100, 'before'), 'after');
  assert.equal(dropSide(49, 100, 'after'), 'after');
  assert.equal(dropSide(35, 100, 'after'), 'before');
  assert.equal(dropSide(15, 20, 'before'), 'after');
});
