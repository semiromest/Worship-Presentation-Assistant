import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Slide, SlideItem } from '../types';
import { createGroup, expandGroup, flattenGroups, ungroupGroup } from './groupUtils';
import { draftToSlide, createDraft } from './slideDraft';

const item = (id: string, patch: Partial<SlideItem> = {}): SlideItem => ({
  id,
  type: 'text',
  content: id,
  styles: {},
  x: 10,
  y: 10,
  width: 20,
  height: 10,
  zIndex: 0,
  ...patch,
});
const byContent = (items: SlideItem[]) =>
  [...items].sort((a, b) => a.zIndex - b.zIndex).map((entry) => entry.content ?? entry.type);
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${actual} ≈ ${expected}`);

const stack = () => [
  item('below', { zIndex: 0 }),
  item('a', { x: 10, y: 10, width: 20, height: 10, zIndex: 1 }),
  item('between', { zIndex: 2 }),
  item('b', { x: 50, y: 30, width: 30, height: 20, zIndex: 3 }),
  item('above', { zIndex: 4 }),
];

test('grouping stores children relative to the group box and keeps the stacking slot', () => {
  const grouped = createGroup(stack(), new Set(['a', 'b']));
  const group = grouped.find((entry) => entry.type === 'group')!;
  assert.deepEqual([group.x, group.y, group.width, group.height], [10, 10, 70, 40]);
  const [a, b] = group.groupItems!;
  // Percentages of the group, which is how CanvasItem draws group children.
  close(a.x, 0); close(a.width, (20 / 70) * 100);
  close(b.x, (40 / 70) * 100); close(b.y, 50); close(b.height, 50);
  assert.deepEqual(byContent(grouped), ['below', 'between', 'group', 'above']);
});

test('grouping ignores locked items and needs two editable members', () => {
  const items = stack().map((entry) => (entry.id === 'b' ? { ...entry, locked: true } : entry));
  assert.equal(createGroup(items, new Set(['a', 'b'])), items);
});

test('ungrouping restores slide geometry and stacking position', () => {
  const grouped = createGroup(stack(), new Set(['a', 'b']));
  const groupId = grouped.find((entry) => entry.type === 'group')!.id;
  const restored = ungroupGroup(grouped, groupId);
  assert.deepEqual(byContent(restored), ['below', 'between', 'a', 'b', 'above']);
  const b = restored.find((entry) => entry.content === 'b')!;
  close(b.x, 50); close(b.y, 30); close(b.width, 30); close(b.height, 20);
});

test('ungrouping a resized group scales the children, and locked groups stay grouped', () => {
  const grouped = createGroup(stack(), new Set(['a', 'b']));
  const group = grouped.find((entry) => entry.type === 'group')!;
  const resized = grouped.map((entry) => (entry.id === group.id ? { ...entry, width: 35, height: 20 } : entry));
  const b = ungroupGroup(resized, group.id).find((entry) => entry.content === 'b')!;
  close(b.x, 30); close(b.width, 15); close(b.y, 20); close(b.height, 10);

  const locked = grouped.map((entry) => (entry.id === group.id ? { ...entry, locked: true } : entry));
  assert.equal(ungroupGroup(locked, group.id), locked);
});

test('a hidden or rotated group passes its state to the children', () => {
  const group: SlideItem = {
    ...item('g', { type: 'group', content: undefined, x: 20, y: 20, width: 40, height: 40, rotation: 180, visible: false }),
    groupItems: [item('c', { x: 0, y: 0, width: 50, height: 50 })],
  };
  const [child] = expandGroup(group, false);
  assert.equal(child.visible, false);
  assert.equal(child.rotation, 180);
  // A 180° turn moves the top-left quarter to the bottom-right quarter.
  close(child.x, 40); close(child.y, 40);
});

test('saving a slide flattens groups so presentation renderers can draw them', () => {
  const slide = { id: 's1', type: 'image', content: '', items: stack() } as unknown as Slide;
  const draft = createDraft(slide);
  const grouped = createGroup(draft.items, new Set(['a', 'b']));
  // Duplicated groups share child ids; flattening must keep ids unique.
  const copy = { ...grouped.find((entry) => entry.type === 'group')!, id: 'copy', zIndex: 99 };
  const saved = draftToSlide(slide, { ...draft, items: [...grouped, copy] });
  assert.ok(saved.items!.every((entry) => entry.type !== 'group'));
  assert.deepEqual(byContent(saved.items!), ['below', 'between', 'a', 'b', 'above', 'a', 'b']);
  assert.equal(new Set(saved.items!.map((entry) => entry.id)).size, saved.items!.length);
  assert.equal(flattenGroups(stack()).length, 5);
});
