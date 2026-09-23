import assert from 'node:assert/strict';
import test from 'node:test';
import { convertGetBiblePayload, normalizeGetBibleCatalog } from './getBibleModel';

const verse = (chapter: number, number: number, text: string) => ({ chapter, verse: number, text });
const book = (nr: number, name: string) => ({
  nr,
  name,
  chapters: [{ chapter: 1, name: `${name} 1`, verses: [verse(1, 1, `${name} verse`)] }],
});

test('converts a 66-book GetBible payload and preserves canonical book numbers', () => {
  const bible = convertGetBiblePayload({
    translation: 'Fixture Bible',
    abbreviation: 'fixture',
    books: Array.from({ length: 66 }, (_, index) => book(index + 1, `Book ${index + 1}`)),
  });

  assert.equal(bible.format, 'getbible');
  assert.equal(bible.books.length, 66);
  assert.equal(bible.books[39].number, '40');
  assert.equal(bible.books[65].chapters[0].verses[0].text, 'Book 66 verse');
});

test('supports partial and deuterocanonical GetBible payloads', () => {
  const partial = convertGetBiblePayload({ translation: 'Partial', books: [book(40, 'Matthew')] });
  const extended = convertGetBiblePayload({ translation: 'Extended', books: [book(1, 'Genesis'), book(67, 'Tobit')] });

  assert.deepEqual(
    partial.books.map((item) => item.number),
    ['40']
  );
  assert.deepEqual(
    extended.books.map((item) => item.number),
    ['1', '67']
  );
});

test('keeps every valid catalog entry regardless of its license', () => {
  const catalog = normalizeGetBibleCatalog({
    kjv: {
      translation: 'KJV',
      abbreviation: 'kjv',
      description: 'KJV',
      lang: 'en',
      language: 'English',
      direction: 'LTR',
      distribution_license: 'Public Domain',
      url: 'https://example.test/kjv.json',
      sha: 'one',
    },
    turkish: {
      translation: 'Turkish',
      abbreviation: 'turkish',
      description: 'Kutsal Kitap',
      lang: 'tr',
      language: 'Turkish',
      direction: 'LTR',
      distribution_license: 'Copyrighted; Permission to distribute granted to CrossWire',
      url: 'https://example.test/turkish.json',
      sha: 'two',
    },
  });

  assert.equal(catalog.total, 2);
  assert.deepEqual(
    catalog.translations.map((item) => item.abbreviation),
    ['kjv', 'turkish']
  );
});
