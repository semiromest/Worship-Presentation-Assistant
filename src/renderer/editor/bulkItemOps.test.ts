import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SlideItem } from '../types';
import {
  bulkTargets,
  canReorderSelection,
  deleteSelection,
  layerClickSelection,
  moveSelection,
  reorderSelection,
  resizeSelection,
  selectableItemIds,
  selectionBounds,
  stylePatch,
  toggleSelectionLock,
  toggleSelectionVisibility,
} from './bulkItemOps';
import { alignItems, layoutSelection } from './alignmentUtils';
import { duplicateItems } from './editorUtils';

const item = (id: string, patch: Partial<SlideItem> = {}): SlideItem => ({
  id,
  type: 'text',
  styles: {},
  x: 10,
  y: 10,
  width: 20,
  height: 10,
  zIndex: 0,
  ...patch,
});
const order = (items: SlideItem[]) =>
  [...items].sort((a, b) => a.zIndex - b.zIndex).map((entry) => entry.id);

test('bulk targets skip locked items and select-all skips hidden and locked ones', () => {
  const items = [item('a'), item('locked', { locked: true }), item('hidden', { visible: false })];
  assert.deepEqual(bulkTargets(items, ['a', 'locked', 'hidden']).map((entry) => entry.id), ['a', 'hidden']);
  assert.deepEqual(selectableItemIds(items), ['a']);
});

test('bulk delete keeps locked items and reports them as still selected', () => {
  const items = [item('a', { zIndex: 0 }), item('locked', { locked: true, zIndex: 1 }), item('b', { zIndex: 2 })];
  const result = deleteSelection(items, ['a', 'locked']);
  assert.deepEqual(result.deleted, ['a']);
  assert.deepEqual(result.kept, ['locked']);
  assert.deepEqual(order(result.items), ['locked', 'b']);

  const onlyLocked = deleteSelection(items, ['locked']);
  assert.equal(onlyLocked.items, items, 'nothing deletable leaves the list untouched (no empty undo step)');
});

test('moving a selection moves it as a clamped block and leaves locked members in place', () => {
  const items = [item('a', { x: 5 }), item('b', { x: 60, width: 30 }), item('locked', { x: 40, locked: true })];
  const moved = moveSelection(items, ['a', 'b', 'locked'], 20, 0);
  // b would hit the right edge at +10, so the whole block stops there.
  assert.deepEqual(moved.map((entry) => entry.x), [15, 70, 40]);
  assert.equal(moveSelection(items, ['locked'], 5, 5), items);
  assert.equal(moveSelection(items, ['b'], 50, 0).find((entry) => entry.id === 'b')!.x, 70);
});

test('selection bounds cover only editable members', () => {
  const items = [item('a', { x: 10, y: 20 }), item('b', { x: 50, y: 5, width: 10, height: 10 }), item('locked', { x: 0, locked: true })];
  assert.deepEqual(selectionBounds(items, ['a', 'b', 'locked']), { x: 10, y: 5, width: 50, height: 25 });
  assert.equal(selectionBounds(items, ['locked']), null);
});

test('lock and visibility toggles use the mixed-state rule', () => {
  const items = [item('a'), item('b', { locked: true })];
  const locked = toggleSelectionLock(items, ['a', 'b']);
  assert.deepEqual(locked.map((entry) => entry.locked), [true, true]);
  assert.deepEqual(toggleSelectionLock(locked, ['a', 'b']).map((entry) => entry.locked), [false, false]);

  const visibility = [item('a'), item('b', { visible: false }), item('c', { locked: true })];
  const hidden = toggleSelectionVisibility(visibility, ['a', 'b', 'c']);
  assert.deepEqual(hidden.map((entry) => entry.visible), [false, false, undefined], 'locked items keep their visibility');
  assert.deepEqual(toggleSelectionVisibility(hidden, ['a', 'b']).map((entry) => entry.visible), [true, true, undefined]);
});

test('z-order actions keep the selection order and move contiguous blocks together', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id, index) => item(id, { zIndex: index }));
  assert.deepEqual(order(reorderSelection(items, ['b', 'd'], 'front')), ['a', 'c', 'e', 'b', 'd']);
  assert.deepEqual(order(reorderSelection(items, ['b', 'd'], 'back')), ['b', 'd', 'a', 'c', 'e']);
  assert.deepEqual(order(reorderSelection(items, ['b', 'c'], 'forward')), ['a', 'd', 'b', 'c', 'e']);
  assert.deepEqual(order(reorderSelection(items, ['b', 'c'], 'backward')), ['b', 'c', 'a', 'd', 'e']);
  assert.deepEqual(order(reorderSelection(items, ['d', 'e'], 'forward')), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(reorderSelection(items, ['d', 'e'], 'front'), items, 'already on top: no change');
  assert.equal(canReorderSelection(items, ['d', 'e'], 'front'), false);
  assert.equal(canReorderSelection(items, ['d', 'e'], 'back'), true);
  const withLock = items.map((entry) => (entry.id === 'b' ? { ...entry, locked: true } : entry));
  assert.deepEqual(order(reorderSelection(withLock, ['a', 'b'], 'front')), ['b', 'c', 'd', 'e', 'a'], 'locked items keep their layer');
});

test('style patches carry only the changed keys, including nested objects', () => {
  const before = { textColor: '#fff', fontSize: 40, textStroke: { width: 0, color: '#000' } };
  assert.deepEqual(stylePatch(before, { ...before, textColor: '#f00' }), { textColor: '#f00' });
  assert.deepEqual(stylePatch(before, { ...before, textStroke: { width: 2, color: '#000' } }), {
    textStroke: { width: 2, color: '#000' },
  });
  assert.deepEqual(stylePatch(before, { ...before }), {});
});

test('resizing a selection sets the size around each centre and stays on the slide', () => {
  const items = [item('a', { x: 10, width: 20 }), item('b', { x: 85, width: 10 }), item('locked', { locked: true })];
  const next = resizeSelection(items, ['a', 'b', 'locked'], 'width', 30);
  assert.deepEqual(next.map((entry) => [entry.x, entry.width]), [[5, 30], [70, 30], [10, 20]]);
  assert.equal(resizeSelection(next, ['a', 'b'], 'width', 30), next);
});

test('layer list clicks support Ctrl toggle and Shift ranges with the clicked row last', () => {
  const rows = ['top', 'mid', 'low', 'bottom'];
  assert.deepEqual(layerClickSelection(rows, new Set(['mid']), 'low', {}), ['low']);
  assert.deepEqual(layerClickSelection(rows, new Set(['mid']), 'bottom', { ctrlKey: true }), ['mid', 'bottom']);
  assert.deepEqual(layerClickSelection(rows, new Set(['mid', 'bottom']), 'mid', { metaKey: true }), ['bottom']);
  assert.deepEqual(layerClickSelection(rows, new Set(['top']), 'low', { shiftKey: true }), ['top', 'mid', 'low']);
  assert.deepEqual(layerClickSelection(rows, new Set(), 'low', { shiftKey: true }), ['low']);
});

test('duplicating several items keeps their relative stacking order', () => {
  const items = ['a', 'b', 'c'].map((id, index) => item(id, { zIndex: index, content: id }));
  // The old implementation used a random z offset, so repeat to catch flips.
  for (let run = 0; run < 20; run += 1) {
    const next = duplicateItems(items, new Set(['a', 'c']));
    const stacked = [...next].sort((x, y) => x.zIndex - y.zIndex);
    assert.deepEqual(stacked.map((entry) => entry.content), ['a', 'b', 'c', 'a', 'c']);
    assert.deepEqual(stacked.slice(3).map((copy) => copy.x), [12, 12]);
  }
});

test('aligning as a block moves the selection to the slide without collapsing it', () => {
  const items = [item('a', { x: 10, y: 10, width: 10 }), item('b', { x: 30, y: 20, width: 20 })];
  const right = alignItems(items, 'right', 'slideBlock');
  assert.deepEqual(right.map((entry) => entry.x), [60, 80]);
  const centred = layoutSelection(items, ['a', 'b'], 'center', 'slideBlock');
  assert.deepEqual(centred.map((entry) => entry.x), [30, 50]);
  // Per-item slide alignment still stacks them on the same edge.
  assert.deepEqual(alignItems(items, 'right', 'slide').map((entry) => entry.x), [90, 80]);
});
