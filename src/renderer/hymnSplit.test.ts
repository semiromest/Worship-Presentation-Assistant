import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitHymnLyrics } from './hymnSplit';

test('explicit verse markers remain stanza boundaries without blank lines', () => {
  assert.deepEqual(splitHymnLyrics('[V1]\nFirst verse\nSecond line\n[V2]\nAnother verse\n[C]\nChorus').parts,
    ['First verse\nSecond line', 'Another verse', 'Chorus']);
});

test('legacy De Haleluya cache restores four proven stanza boundaries without changing lines', () => {
  const lines = ["De Haleluya İsa'ya", 'Bir', 'İki', 'Üç', 'Seni seviyorum, Rabbim', 'Dört', 'Beş', 'Altı',
    "İsa gökte yerde Rab'dir", 'Yedi', 'Sekiz', 'Dokuz', 'Rab İsa tekrar gelecek', 'On', 'On bir', 'On iki'];
  const result = splitHymnLyrics(lines.join('\n')).parts;
  assert.equal(result.length, 4);
  assert.deepEqual(result.flatMap(part => part.split('\n')), lines);
  assert.deepEqual(result.map(part => part.split('\n')[0]), [lines[0], lines[4], lines[8], lines[12]]);
});

test('ordinary long stanzas and user-edited shapes are not guessed into arbitrary parts', () => {
  const lyrics = Array.from({ length: 16 }, (_, i) => `Line ${i}`).join('\n');
  assert.deepEqual(splitHymnLyrics(lyrics).parts, [lyrics]);
  assert.deepEqual(splitHymnLyrics('First\nSecond\n\nThird').parts, ['First\nSecond', 'Third']);
});
