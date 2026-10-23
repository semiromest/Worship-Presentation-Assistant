import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstHymnLine, hymnSortOrder, sortHymns } from './hymnLibrary';
const records = ['İlahi 10', 'Ilahi 2', 'ılahi 1', 'ilahi 2', 'İlahi 2', 'Ámen', 'Amen'].map((title, i) => ({ id: String(i), title, lyrics: '' }));
test('original order and invalid preference preserve the archive identity', () => {
  assert.equal(hymnSortOrder('broken'), 'original'); assert.equal(hymnSortOrder(null), 'original');
  assert.equal(sortHymns(records, 'original', 'tr'), records);
});
test('locale sorting preserves equal-title original order in both directions and never mutates the archive', () => {
  const original = records.map(h => h.id);
  for (const lang of ['tr', 'en', 'de', 'es', 'ko']) for (const order of ['title-asc', 'title-desc'] as const) {
    const result = sortHymns(records, order, lang);
    const compare = new Intl.Collator(lang, { usage: 'sort', sensitivity: 'base', numeric: true });
    for (let i = 1; i < result.length; i++) {
      const c = compare.compare(result[i - 1].title, result[i].title);
      assert.ok(order === 'title-asc' ? c <= 0 : c >= 0);
      if (c === 0) assert.ok(Number(result[i - 1].id) < Number(result[i].id));
    }
  }
  assert.deepEqual(records.map(h => h.id), original);
  const tr = sortHymns(records, 'title-asc', 'tr').map(h => h.id);
  assert.ok(tr.indexOf('3') < tr.indexOf('0')); // numeric 2 before 10
  assert.ok(tr.indexOf('1') < tr.indexOf('3')); // Turkish dotless I before dotted i
});
test('first non-empty lyric line handles whitespace and Windows newlines', () => {
  assert.equal(firstHymnLine('\r\n  \r\n First line \r\nNext'), 'First line');
  assert.equal(firstHymnLine('  '), '');
});
