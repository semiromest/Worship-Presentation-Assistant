import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapGuides, sameGuides, type SnapGuide } from './snapGuides';
import type { SlideItem } from '../types';

function legacy(items: SlideItem[], id: string, x: number, y: number): SnapGuide[] {
  const dragged = items.find(item => item.id === id);
  if (!dragged) return [];
  const guides: SnapGuide[] = [];
  for (const other of items) {
    if (other.id === id || other.visible === false) continue;
    if (Math.abs(x - other.x) > 1 && Math.abs(x + dragged.width - other.x - other.width) > 1 &&
      Math.abs(y - other.y) > 1 && Math.abs(y + dragged.height - other.y - other.height) > 1) continue;
    for (const [d, o] of [[x, other.x], [x + dragged.width, other.x + other.width], [x + dragged.width / 2, other.x + other.width / 2]]) {
      if (Math.abs(d - o) < 1) { guides.push({ orientation: 'vertical', position: o }); break; }
    }
    for (const [d, o] of [[y, other.y], [y + dragged.height, other.y + other.height], [y + dragged.height / 2, other.y + other.height / 2]]) {
      if (Math.abs(d - o) < 1) { guides.push({ orientation: 'horizontal', position: o }); break; }
    }
  }
  return guides;
}

test('scalar snap calculations preserve threshold, visibility and match priority at 20/100/500 items', () => {
  for (const count of [20, 100, 500]) {
    const items = Array.from({ length: count }, (_, i) => ({ id: String(i), type: 'text',
      x: i % 20 * 4, y: i % 17 * 5, width: 10 + i % 7, height: 8 + i % 5, visible: i % 9 !== 1 } as SlideItem));
    for (let step = 0; step < 100; step++) {
      const x = step * 0.5, y = step * 0.25;
      assert.deepEqual(snapGuides(items, '0', x, y), legacy(items, '0', x, y));
    }
    const moved = items.map((item, i) => i === 1 ? { ...item, x: 0, y: 0, visible: true } : item);
    assert.deepEqual(snapGuides(moved, '0', 0, 0), legacy(moved, '0', 0, 0));
  }
  assert.ok(sameGuides([], []));
  assert.ok(!sameGuides([{ orientation: 'vertical', position: 0 }], [{ orientation: 'horizontal', position: 0 }]));
});
