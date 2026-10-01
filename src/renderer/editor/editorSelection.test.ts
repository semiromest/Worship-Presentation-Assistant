import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSelection,
  clickSelect,
  createSelection,
  isAllSelected,
  isMultiSelect,
  moveActive,
  normalizeSelection,
  selectAll,
  selectEdge,
} from './editorSelection';

const order = ['a', 'b', 'c', 'd', 'e'];

const assertInvariants = (selection: { activeId: string; selectedIds: string[] }) => {
  assert.ok(selection.selectedIds.length > 0, 'at least one slide stays selected');
  assert.ok(
    selection.selectedIds.includes(selection.activeId),
    'the active slide is always part of the selection',
  );
  assert.equal(
    new Set(selection.selectedIds).size,
    selection.selectedIds.length,
    'no duplicate slides in the selection',
  );
};

test('a plain click activates one slide and re-anchors the range', () => {
  const next = clickSelect(createSelection('a'), order, 'c');
  assert.equal(next.activeId, 'c');
  assert.deepEqual(next.selectedIds, ['c']);
  assert.equal(next.anchorIndex, null, 'the next Shift+click anchors on this slide');
  assertInvariants(next);
});

test('Ctrl+click toggles slides into and out of the bulk set', () => {
  let selection = createSelection('a');
  selection = clickSelect(selection, order, 'c', { ctrl: true });
  selection = clickSelect(selection, order, 'e', { ctrl: true });

  assert.equal(isMultiSelect(selection), true);
  assert.deepEqual(selection.selectedIds, ['a', 'c', 'e']);
  assert.equal(selection.activeId, 'e', 'the last added slide becomes active');

  selection = clickSelect(selection, order, 'c', { ctrl: true });
  assert.deepEqual(selection.selectedIds, ['a', 'e'], 'toggled off in deck order');

  selection = clickSelect(selection, order, 'e', { ctrl: true });
  assert.equal(selection.activeId, 'a', 'removing the active slide falls back to a remaining one');
  assertInvariants(selection);
});

test('Ctrl+click can never empty the selection', () => {
  let selection = createSelection('b');
  selection = clickSelect(selection, order, 'b', { ctrl: true });
  assert.deepEqual(selection.selectedIds, ['b']);
  assert.equal(selection.activeId, 'b');
  assertInvariants(selection);
});

test('a fresh selection deep in a long deck anchors on its own slide', () => {
  const longOrder = Array.from({ length: 40 }, (_, i) => `s${i}`);
  let selection = createSelection('s30');
  selection = clickSelect(selection, longOrder, 's32', { shift: true });
  assert.deepEqual(selection.selectedIds.slice(0, 3), ['s30', 's31', 's32']);
  assert.equal(selection.selectedIds.length, 3, 'ranges never start back at slide 1');
});

test('Shift+click selects the range from the anchor in both directions', () => {
  let selection = clickSelect(createSelection('c'), order, 'c');
  selection = clickSelect(selection, order, 'e', { shift: true });
  assert.deepEqual(selection.selectedIds, ['c', 'd', 'e']);
  assert.equal(selection.activeId, 'e');
  assert.equal(selection.anchorIndex, 2, 'the resolved anchor stays put for further extension');

  selection = clickSelect(selection, order, 'a', { shift: true });
  assert.deepEqual(selection.selectedIds, ['a', 'b', 'c']);
  assert.equal(selection.activeId, 'a');
});

test('arrow navigation moves the active slide and clamps at the edges', () => {
  let selection = createSelection('c');
  selection = moveActive(selection, order, 1);
  assert.equal(selection.activeId, 'd');
  assert.deepEqual(selection.selectedIds, ['d']);

  selection = moveActive(selection, order, 10);
  assert.equal(selection.activeId, 'e', 'clamped at the last slide');

  selection = moveActive(selection, order, -10);
  assert.equal(selection.activeId, 'a', 'clamped at the first slide');
  assertInvariants(selection);
});

test('Shift+arrow extends the range from the anchor', () => {
  let selection = createSelection('b'); // no anchor yet → resolves to slide b
  selection = moveActive(selection, order, 1, true);
  selection = moveActive(selection, order, 1, true);
  assert.deepEqual(selection.selectedIds, ['b', 'c', 'd']);
  assert.equal(selection.activeId, 'd');

  selection = moveActive(selection, order, -2, true);
  assert.deepEqual(selection.selectedIds, ['b'], 'shrinking back onto the anchor keeps one slide');
  assertInvariants(selection);
});

test('Home and End jump to the edges and can extend', () => {
  let selection = createSelection('c');
  selection = selectEdge(selection, order, 'start');
  assert.equal(selection.activeId, 'a');

  selection = selectEdge(selection, order, 'end', true);
  assert.deepEqual(selection.selectedIds, order);

  selection = selectEdge(selection, order, 'start', true);
  assert.deepEqual(selection.selectedIds, ['a']);
});

test('select all, clear and the all-selected predicate', () => {
  let selection = createSelection('c');
  selection = selectAll(selection, order);
  assert.deepEqual(selection.selectedIds, order);
  assert.equal(isAllSelected(selection, order), true);
  assert.equal(selection.activeId, 'c', 'select-all keeps the working slide');

  selection = clearSelection(selection, order);
  assert.deepEqual(selection.selectedIds, ['c']);
  assert.equal(isAllSelected(selection, order), false);
});

test('a selection referencing a deleted slide is repaired against the deck', () => {
  const selection = normalizeSelection(
    { activeId: 'gone', selectedIds: ['gone', 'b'], anchorIndex: 3 },
    ['a', 'b', 'c'],
  );

  assert.equal(selection.activeId, 'b');
  assert.deepEqual(selection.selectedIds, ['b']);
  assert.equal(selection.anchorIndex, null, 'an out-of-range anchor re-anchors instead of guessing');
  assertInvariants(selection);
});

test('an empty selection collapses onto a valid slide', () => {
  const selection = normalizeSelection({ activeId: 'a', selectedIds: [], anchorIndex: 0 }, order);
  assert.deepEqual(selection.selectedIds, ['a']);
  assertInvariants(selection);
});

test('a long random walk of rail interactions never breaks the invariants', () => {
  const ids = order;
  let selection = createSelection(ids[0]);
  const steps: Array<() => void> = [
    () => { selection = clickSelect(selection, ids, ids[(ids.indexOf(selection.activeId) + 1) % ids.length]); },
    () => { selection = clickSelect(selection, ids, ids[0], { ctrl: true }); },
    () => { selection = clickSelect(selection, ids, ids[ids.length - 1], { shift: true }); },
    () => { selection = moveActive(selection, ids, 1, true); },
    () => { selection = moveActive(selection, ids, -1); },
    () => { selection = selectAll(selection, ids); },
    () => { selection = clearSelection(selection, ids); },
    () => { selection = normalizeSelection(selection, ids); },
  ];

  for (let i = 0; i < 200; i++) {
    steps[i % steps.length]();
    assertInvariants(selection);
    for (const id of selection.selectedIds) assert.ok(ids.includes(id));
  }
});
