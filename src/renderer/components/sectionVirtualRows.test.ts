import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionVirtualRows } from './sectionVirtualRows';

test('large section mounts a bounded viewport and preserves full scroll geometry', () => {
  for (const count of [100, 1000, 5000]) {
    const rows = sectionVirtualRows(count, 3, 900, 0, 600);
    assert.ok(rows.end - rows.start <= 8);
    assert.equal(rows.height, Math.ceil(count / 3) * rows.stride - 12);
    const middle = sectionVirtualRows(count, 3, 900, rows.height / 2, rows.height / 2 + 600);
    assert.ok(middle.start > 0);
    assert.ok(middle.end - middle.start <= 11);
  }
});

test('offscreen, empty and resized sections have valid ranges', () => {
  assert.equal(sectionVirtualRows(5000, 3, 900, -2000, -1000).end, 0);
  const above = sectionVirtualRows(10, 3, 900, 5000, 5600);
  assert.equal(above.start, above.end);
  assert.equal(sectionVirtualRows(0, 3, 900, 0, 600).height, 0);
  assert.ok(sectionVirtualRows(100, 2, 900, 0, 600).stride > sectionVirtualRows(100, 3, 900, 0, 600).stride);
});

test('zoomed section row spacing follows the rendered card width', () => {
  const regular = sectionVirtualRows(100, 3, 1400, 0, 600, 320);
  const larger = sectionVirtualRows(100, 3, 1400, 0, 600, 352);
  assert.equal(regular.stride, 320 * 9 / 16 + 12);
  assert.equal(larger.stride, 352 * 9 / 16 + 12);
  assert.ok(larger.height > regular.height);
});
