import test from 'node:test';
import assert from 'node:assert/strict';
import type { MediaItem } from './types';
import {
  clampDurationSecs,
  computeGridMetrics,
  computeVisibleRange,
  countMediaByType,
  filterAndSortMedia,
  formatLoopTime,
  moveItem,
  parseMediaViewPrefs,
  rangeIds,
} from './mediaLibraryModel';

const item = (id: string, name: string, type: MediaItem['type']): MediaItem => ({ id, name, type, path: `C:/m/${name}` });
const library = [item('1', 'Şükran 10.mp4', 'video'), item('2', 'duyuru 2.png', 'image'), item('3', 'Duyuru 1.jpg', 'image')];

test('filters by type and accent/case-insensitive multi-term search', () => {
  assert.deepEqual(filterAndSortMedia(library, { query: '', filter: 'image', sort: 'added' }).map((m) => m.id), ['2', '3']);
  assert.deepEqual(filterAndSortMedia(library, { query: 'sukran', filter: 'all', sort: 'added' }).map((m) => m.id), ['1']);
  assert.deepEqual(filterAndSortMedia(library, { query: 'DUYURU png', filter: 'all', sort: 'added' }).map((m) => m.id), ['2']);
});

test('sorts by natural name and by type then name without mutating input', () => {
  const snapshot = library.map((m) => m.id);
  assert.deepEqual(filterAndSortMedia(library, { query: '', filter: 'all', sort: 'name' }, 'tr').map((m) => m.id), ['3', '2', '1']);
  assert.deepEqual(filterAndSortMedia(library, { query: '', filter: 'all', sort: 'type' }, 'tr').map((m) => m.id), ['3', '2', '1']);
  assert.deepEqual(library.map((m) => m.id), snapshot);
});

test('counts media by type', () => {
  assert.deepEqual(countMediaByType(library), { all: 3, image: 2, video: 1 });
});

test('view prefs fall back to defaults for unknown values', () => {
  assert.deepEqual(parseMediaViewPrefs({ filter: 'video', sort: 'bogus', density: 'compact' }), { filter: 'video', sort: 'added', density: 'compact' });
  assert.deepEqual(parseMediaViewPrefs(null), { filter: 'all', sort: 'added', density: 'comfortable' });
});

test('grid metrics fill the width with 16:9 previews', () => {
  const m = computeGridMetrics(1000, 'comfortable', 12);
  assert.equal(m.cols, 3);
  assert.ok(Math.abs(m.cardWidth * 3 + 24 - 1000) < 1e-9);
  assert.equal(m.previewHeight, Math.round((m.cardWidth * 9) / 16));
  assert.equal(m.rowHeight, m.cardHeight + 12);
  assert.equal(computeGridMetrics(0, 'compact').cols, 1);
  assert.ok(computeGridMetrics(1000, 'compact').cols > m.cols);
});

test('visible range clamps to the rows that exist', () => {
  assert.deepEqual(computeVisibleRange(0, 500, 100, 20, 2), { startRow: 0, endRow: 7 });
  assert.deepEqual(computeVisibleRange(1900, 500, 100, 20, 2), { startRow: 17, endRow: 19 });
  assert.deepEqual(computeVisibleRange(0, 500, 100, 0, 2), { startRow: 0, endRow: -1 });
});

test('moveItem and rangeIds', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.equal(moveItem(list, 1, 1), list);
  assert.equal(moveItem(list, 0, 9), list);
  const ordered = list.map((id) => ({ id }));
  assert.deepEqual(rangeIds(ordered, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeIds(ordered, 'zz', 'b'), ['b']);
});

test('time formatting and duration clamping', () => {
  assert.equal(formatLoopTime(65_000), '1:05');
  assert.equal(formatLoopTime(0), '0:00');
  assert.equal(clampDurationSecs('0'), 1);
  assert.equal(clampDurationSecs('7.6'), 8);
  assert.equal(clampDurationSecs(999), 300);
  assert.equal(clampDurationSecs('abc'), 1);
});
