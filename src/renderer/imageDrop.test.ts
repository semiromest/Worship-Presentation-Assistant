import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Presentation, Slide } from './types';
import { undoReducer } from './state/undoReducer';

let insertDroppedImages: typeof import('./imageDrop').insertDroppedImages;
before(async () => {
  Object.assign(globalThis, { window: { location: { search: '' } } });
  ({ insertDroppedImages } = await import('./imageDrop'));
});

const deckWith = (target: Partial<Slide> = {}): Presentation => ({
  id: 'deck', name: 'Test', slides: [
    { id: 'target', type: 'text', content: 'Keep this text', ...target },
    { id: 'last', type: 'text', content: 'Last slide' },
  ],
});

test('each image becomes a standalone slide after the target in file order', () => {
  const deck = deckWith();
  const next = insertDroppedImages(deck, 'target', ['C:\\Photos\\a #1.png', 'C:\\Photos\\b.jpg']);
  assert.equal(next.slides.length, 4);
  assert.equal(next.slides[0], deck.slides[0]);
  assert.equal(next.slides[3], deck.slides[1]);
  assert.deepEqual(next.slides.slice(1, 3).map(slide => slide.mediaUrl), [
    'file:///C:/Photos/a%20%231.png', 'file:///C:/Photos/b.jpg',
  ]);
  for (const slide of next.slides.slice(1, 3)) {
    assert.equal(slide.type, 'image');
    assert.equal(slide.items, undefined);
    assert.equal(slide.styles?.objectFit, 'contain');
  }
  assert.equal(new Set(next.slides.map(slide => slide.id)).size, 4);
  assert.equal(deck.slides.length, 2);
});

test('hymn content and background stay untouched; only section membership is inherited', () => {
  const deck = deckWith({ partsMode: true, parts: ['One', 'Two'], activePart: 1,
    group: { id: 'hymn', title: 'Hymn', part: 1, parts: 2 }, sectionId: 'section' });
  const next = insertDroppedImages(deck, 'target', ['C:\\photo.png']);
  assert.equal(next.slides[0], deck.slides[0]);
  assert.equal(next.slides[1].sectionId, 'section');
  assert.equal(next.slides[1].group, undefined);
  assert.equal(next.slides[1].partsMode, undefined);
});

test('any slide type can be the target, including the last slide', () => {
  for (const type of ['video', 'image', 'screen', 'countdown', 'loop', 'captions'] as const) {
    const deck = deckWith();
    deck.slides[1] = { ...deck.slides[1], type };
    const next = insertDroppedImages(deck, 'last', ['C:\\photo.png']);
    assert.equal(next.slides[1], deck.slides[1]);
    assert.equal(next.slides[2].type, 'image');
  }
});

test('empty drops or deleted targets leave the presentation unchanged', () => {
  const deck = deckWith();
  assert.equal(insertDroppedImages(deck, 'target', []), deck);
  assert.equal(insertDroppedImages(deck, 'missing', ['C:\\photo.png']), deck);
});

test('dropping into empty space appends all images after the last slide', () => {
  const deck = deckWith();
  deck.slides[1] = { ...deck.slides[1], sectionId: 'last-section' };
  const next = insertDroppedImages(deck, undefined, ['C:\\a.png', 'C:\\b.png']);
  assert.equal(next.slides[0], deck.slides[0]);
  assert.equal(next.slides[1], deck.slides[1]);
  assert.deepEqual(next.slides.slice(2).map(slide => slide.mediaUrl), ['file:///C:/a.png', 'file:///C:/b.png']);
  assert.ok(next.slides.slice(2).every(slide => slide.sectionId === 'last-section'));
});

test('dropping into an empty presentation creates its first image slide', () => {
  const deck = { ...deckWith(), slides: [] };
  const next = insertDroppedImages(deck, undefined, ['C:\\a.png']);
  assert.equal(next.slides.length, 1);
  assert.equal(next.slides[0].type, 'image');
  assert.equal(deck.slides.length, 0);
});

test('multiple inserted images undo and redo together', () => {
  const deck = deckWith();
  const next = insertDroppedImages(deck, 'target', ['C:\\a.png', 'C:\\b.png']);
  const committed = undoReducer({ past: [], present: deck, future: [] }, { type: 'SET', payload: next });
  const undone = undoReducer(committed, { type: 'UNDO' });
  assert.deepEqual(undone.present.slides.map(slide => slide.id), ['target', 'last']);
  const redone = undoReducer(undone, { type: 'REDO' });
  assert.deepEqual(redone.present.slides.map(slide => slide.id), next.slides.map(slide => slide.id));
});
