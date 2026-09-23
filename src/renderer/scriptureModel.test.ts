import assert from 'node:assert/strict';
import test from 'node:test';
import type { BibleBook, Chapter } from './bibleParser';
import {
  createScriptureSlides,
  filterBooksForReference,
  findBookForReference,
  formatVerseNumbers,
  parseScriptureReference,
  splitBibleTestaments,
} from './scriptureModel';

const chapter: Chapter = {
  number: '3',
  verses: [1, 2, 3, 4, 5].map((number) => ({ number: String(number), text: `Verse ${number}` })),
};
const book: BibleBook = { name: 'Yuhanna', number: '43', chapters: [chapter] };

test('parses Turkish and English-style scripture ranges', () => {
  assert.deepEqual(parseScriptureReference('Yuhanna 3:16-18'), {
    book: 'yuhanna',
    chapter: 3,
    verse: 16,
    verseTo: 18,
  });
  assert.equal(parseScriptureReference('John 1')?.book, 'john');
  assert.deepEqual(parseScriptureReference('Yaratılış 2:'), {
    book: 'yaratilis',
    chapter: 2,
    verse: null,
    verseTo: null,
  });
  assert.deepEqual(parseScriptureReference('Yaratılış 2:13-'), {
    book: 'yaratilis',
    chapter: 2,
    verse: 13,
    verseTo: 13,
  });
});

test('filters the canonical book list and only auto-selects an unambiguous match', () => {
  const books: BibleBook[] = [
    { name: 'Yaratılış', number: '1', chapters: [] },
    { name: 'Yeşaya', number: '23', chapters: [] },
    { name: 'Yuhanna', number: '43', chapters: [] },
    { name: '1. Yuhanna', number: '62', chapters: [] },
  ];
  assert.deepEqual(
    filterBooksForReference(books, 'Yarat 2:13').map((item) => item.name),
    ['Yaratılış']
  );
  assert.equal(findBookForReference(books, 'yarat')?.name, 'Yaratılış');
  assert.equal(findBookForReference(books, 'yuh'), null);
  assert.equal(findBookForReference(books, 'yuhanna')?.name, 'Yuhanna');
});

test('splits the New Testament by canonical number before localized names', () => {
  const books: BibleBook[] = [
    { name: 'Malaki', number: '39', chapters: [] },
    { name: 'Matthew', number: '40', chapters: [] },
  ];
  const result = splitBibleTestaments(books);
  assert.deepEqual(
    result.oldTestament.map((item) => item.number),
    ['39']
  );
  assert.deepEqual(
    result.newTestament.map((item) => item.number),
    ['40']
  );
});

test('formats discontinuous verse selections without implying missing verses', () => {
  assert.equal(formatVerseNumbers(['1', '2', '3', '5']), '1–3, 5');
});

test('each generated slide carries the reference for its own verse chunk', () => {
  const slides = createScriptureSlides(book, chapter, ['1', '2', '5'], {
    maxVerses: 2,
    maxChars: 500,
    maxLines: 2,
  });
  assert.equal(slides.length, 2);
  assert.match(slides[0], /^Yuhanna 3:1–2/);
  assert.match(slides[1], /^Yuhanna 3:5/);
});
