import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slideGridGeometry, slideGridScrollTop, normalizeSlideColumns, ROW_GAP } from '../components/slideGridGeometry';

test('one through eight columns fill the available width exactly', () => {
  for (const width of [220, 300, 572, 728, 900, 1200, 1429, 1800]) {
    let previous = Infinity;
    for (let count = 1; count <= 8; count++) {
      const layout = slideGridGeometry(width, count);
      assert.equal(layout.columns, count);
      assert.ok(Math.abs(layout.cardWidth * count + ROW_GAP * (count - 1) - width) < 0.0001);
      assert.ok(layout.cardWidth < previous);
      assert.equal(layout.rowHeight, Math.floor(layout.cardWidth * 9 / 16) + 8 + ROW_GAP);
      previous = layout.cardWidth;
    }
  }
});

test('column count handles invalid values and hidden containers safely', () => {
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(normalizeSlideColumns(value), 4);
  assert.equal(normalizeSlideColumns(0), 1);
  assert.equal(normalizeSlideColumns(20), 8);
  assert.equal(normalizeSlideColumns(3.6), 4);
  for (const width of [0, 1, 12, 40]) {
    const layout = slideGridGeometry(width, 8);
    assert.ok(layout.cardWidth >= 1);
    assert.ok(layout.cardWidth * layout.columns + ROW_GAP * (layout.columns - 1) <= Math.max(1, width));
  }
});

test('changing columns retains the first visible slide row and relative offset', () => {
  const previous = slideGridGeometry(1429, 3);
  const next = slideGridGeometry(1429, 6);
  const top = previous.rowHeight * 10.25;
  assert.equal(slideGridScrollTop(top, previous, next), Math.round(next.rowHeight * 5.25));
  assert.equal(slideGridScrollTop(0, previous, next), 0);
  assert.equal(slideGridScrollTop(20, { columns: 1, rowHeight: 0 }, next), 20);
});
