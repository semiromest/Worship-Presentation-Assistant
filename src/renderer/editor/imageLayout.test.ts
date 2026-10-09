import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SlideItem, Slide } from '../types';
import { layoutSelection } from './alignmentUtils';
import { replaceImage, restoreImageRatio } from './imageOperations';
import { resizeItemBounds, sizeFromCenter } from './canvasGeometry';
import { createEditorHistory, editorDeckReducer } from './useEditorDeck';
import { applyDraftsToDeck } from './slideDraft';
import { updateItemAt } from './editorUtils';

const item = (id: string, patch: Partial<SlideItem> = {}): SlideItem => ({
  id,
  type: 'image',
  styles: {},
  x: 10,
  y: 10,
  width: 20,
  height: 20,
  zIndex: 0,
  ...patch,
});
test('alignment changes only editable selected objects and can align a single item to the slide', () => {
  const items = [
    item('a'),
    item('b', { x: 40 }),
    item('locked', { locked: true, x: 70 }),
    item('hidden', { visible: false }),
    item('other', { x: 90 }),
  ];
  const next = layoutSelection(items, ['a', 'b', 'locked', 'hidden'], 'left');
  assert.equal(next[1].x, 10);
  for (const index of [2, 3, 4]) assert.equal(next[index], items[index]);
  assert.equal(layoutSelection(items, ['a'], 'right', 'slide')[0].x, 80);
});
test('size matching uses last editable selection and preserves centers subject to bounds', () => {
  const items = [item('a', { x: 90, width: 10 }), item('b', { width: 30 }), item('c', { width: 40, locked: true })];
  const next = layoutSelection(items, ['a', 'b', 'c'], 'sameWidth');
  assert.equal(next[0].width, 30);
  assert.equal(next[0].x, 70);
  assert.equal(next[2], items[2]);
  const reverse = layoutSelection(items, ['b', 'a'], 'sameWidth');
  assert.equal(reverse[1].width, 10);
});
test('equal gap distribution preserves endpoints and excludes other objects', () => {
  const items = [
    item('a', { x: 0, width: 10 }),
    item('b', { x: 20, width: 20 }),
    item('c', { x: 80, width: 10 }),
    item('other'),
  ];
  const next = layoutSelection(items, ['a', 'b', 'c'], 'distributeHorizontal');
  assert.equal(next[0].x, 0);
  assert.equal(next[1].x, 35);
  assert.equal(next[2].x, 80);
  assert.equal(next[3], items[3]);
});
test('ratio lock works at each rotated corner and in numeric controls without zoom dependence', () => {
  const start = item('a', { x: 30, y: 30, width: 30, height: 20, rotation: 30 });
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const)
    for (const zoom of [0.5, 1, 2]) {
      const next = resizeItemBounds(
        start,
        corner,
        30 * zoom,
        15 * zoom,
        { width: 1000 * zoom, height: 562.5 * zoom },
        0,
        true
      );
      assert.ok(Math.abs(next.width / next.height - 1.5) < 1e-8);
      assert.ok(next.x >= 0 && next.y >= 0 && next.x + next.width <= 100 && next.y + next.height <= 100);
    }
  const numeric = sizeFromCenter(start, 'width', 50, true);
  assert.ok(Math.abs(numeric.width / numeric.height - 1.5) < 1e-8);
  assert.equal(numeric.x + numeric.width / 2, start.x + start.width / 2);
  assert.ok(
    Math.abs(((restoreImageRatio(start, 4 / 3).width / restoreImageRatio(start, 4 / 3).height) * 16) / 9 - 4 / 3) < 1e-8
  );
});
test('image replacement keeps geometry and filters but removes old crop metadata', () => {
  const original = item('a', {
    mediaUrl: 'old',
    rotation: 45,
    imageStyles: { brightness: 0.8, cropMode: 'source', crop: { x: 20, y: 20, width: 40, height: 40 } },
  });
  const next = replaceImage(original, 'new');
  assert.equal(next.rotation, 45);
  assert.equal(next.x, original.x);
  assert.equal(next.width, original.width);
  assert.equal(next.imageStyles?.brightness, 0.8);
  assert.equal(next.imageStyles?.crop, undefined);
  assert.equal(next.imageStyles?.cropMode, undefined);
});

test('scope-aware resize computes each counterpart from its own center and ratio', () => {
  const first = item('a', { x: 10, y: 10, width: 20, height: 10 });
  const second = item('b', { x: 60, y: 60, width: 10, height: 20 });
  const resize = (target: SlideItem) => sizeFromCenter(target, 'width', 30, true);
  const a = updateItemAt([first], first.id, resize)[0];
  const b = updateItemAt([second], second.id, resize)[0];
  assert.equal(a.width / a.height, 2);
  assert.equal(b.width / b.height, 0.5);
  assert.equal(b.x + b.width / 2, second.x + second.width / 2);
  assert.equal(b.y + b.height / 2, second.y + second.height / 2);
});
test('crop apply and layout each create one undo entry; saving retains source crop', () => {
  const slide: Slide = { id: 's', type: 'text', content: '', items: [item('a'), item('b', { x: 60 })] };
  let state = createEditorHistory(slide);
  const draft = state.session.drafts.get('s')!;
  const cropped = draft.items.map((i) =>
    i.id === 'a'
      ? { ...i, imageStyles: { cropMode: 'source' as const, crop: { x: 25, y: 10, width: 50, height: 80 } } }
      : i
  );
  state = editorDeckReducer(state, {
    type: 'mutateSlide',
    slide,
    mutate: (d) => ({ ...d, items: cropped }),
    history: true,
  });
  assert.equal(state.past.length, 1);
  const saved = applyDraftsToDeck({ id: 'deck', name: 'test', slides: [slide] }, state.session.drafts);
  assert.equal(saved!.slides[0].items?.[0].imageStyles?.cropMode, 'source');
  state = editorDeckReducer(state, {
    type: 'mutateSlide',
    slide,
    mutate: (d) => ({ ...d, items: layoutSelection(d.items, ['a', 'b'], 'center', 'slide') }),
    history: true,
  });
  assert.equal(state.past.length, 2);
  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.drafts.get('s')!.items[0].imageStyles?.cropMode, 'source');
  state = editorDeckReducer(state, { type: 'undo' });
  assert.equal(state.session.drafts.get('s')!.items[0].imageStyles?.crop, undefined);
});
