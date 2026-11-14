import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchHymns, searchMedia, searchScripture } from './quickSearchModel';

const bible = {
  books: [
    {
      name: 'Yuhanna',
      number: '43',
      chapters: [{ number: '1', verses: [1, 2, 3, 4, 5, 6].map((n) => ({ number: String(n), text: `Ayet ${n}` })) }],
    },
  ],
};

test('scripture search returns exact ranges, whole chapter only with "::"', () => {
  const range = searchScripture(bible as never, null, 'yuhanna 1:3-5');
  assert.deepEqual(range[0].verseNumbers, ['3', '4', '5']);
  assert.deepEqual(searchScripture(bible as never, null, 'yuhanna 1'), []);
  const whole = searchScripture(bible as never, null, 'yuhanna 1::');
  assert.deepEqual(whole[0].verseNumbers, ['1', '2', '3', '4', '5', '6']);
});

const hymn = (id: string, title: string, lyrics = '') => ({ id, title, lyrics });

test('hymn search ranks title prefix before title match before lyrics, ignoring Turkish diacritics', () => {
  const found = searchHymns(
    [hymn('1', 'Sonsuz Sevgi', 'Işık doğdu'), hymn('2', 'Işık', 'x'), hymn('3', 'Büyük Işık Geldi')],
    'ışık'
  );
  assert.deepEqual(found.map((h) => h.id), ['2', '3', '1']);
});

test('empty queries return nothing and media matches every word in the file name', () => {
  assert.deepEqual(searchHymns([hymn('1', 'A')], '  '), []);
  const items = [
    { id: 'a', type: 'image' as const, path: 'C:/x/Paskalya Sabah.jpg', name: 'Paskalya Sabah.jpg' },
    { id: 'b', type: 'video' as const, path: 'C:/x/Noel.mp4', name: 'Noel.mp4' },
  ];
  assert.deepEqual(searchMedia(items, 'paskalya sabah').map((i) => i.id), ['a']);
  assert.deepEqual(searchMedia(items, 'xyz'), []);
});
