import assert from 'node:assert/strict';
import test from 'node:test';
import type { BibleBook, Chapter } from './bibleParser';
import fixture from './verifiedGenesis23.json';
import {
  getChapterReading,
  parseVerseNumbers,
  resolveReadingReference,
  selectedReadingNumbers,
} from './scriptureReading';
import { createScriptureSlides, formatVerseNumbers, buildReferenceSuggestions } from './scriptureModel';
import { bibleRepository } from './bibleRepository';
import { resolveQuickVerse } from './quickVerse';
import { createBibleSearchIndexer } from './bibleSearchIndex';

const config = { maxVerses: 3, maxChars: 10000, maxLines: 3 };
const book: BibleBook = { number: '1', name: 'Yaratılış', chapters: [fixture.chapter] };
const source = { type: 'online' as const, id: fixture.sourceId };
const make = (verses: Chapter['verses']) => ({ number: '3', verses });

test('reviewed real Genesis 23 pattern restores three bridges without mutating source', () => {
  const before = JSON.stringify(fixture.chapter);
  const reading = getChapterReading(book, fixture.chapter, source);
  assert.deepEqual(
    reading.entries.filter((entry) => entry.evidence).map((entry) => entry.number),
    ['5–6', '14–15', '17–18']
  );
  assert.equal(reading.available.length, 17);
  assert.equal(JSON.stringify(fixture.chapter), before);
  assert.equal(getChapterReading(book, fixture.chapter, source), reading);
  for (const number of [6, 15, 18]) {
    const result = resolveReadingReference(reading, [String(number)]);
    assert.equal(result.status, 'complete');
    assert.equal(result.entries.length, 1);
    assert.equal(result.covered.length, 2);
    assert.equal(result.entries[0].records.length, 2);
  }
});

test('unknown local identity requires full reviewed chapter; names do not authorize rules', () => {
  assert.equal(getChapterReading(book, fixture.chapter, { type: 'local', id: 'unknown.xml' }).available.length, 17);
  for (const other of [
    { type: 'online' as const, id: 'other.xml' },
    { ...source, revision: 'unreviewed' },
  ]) {
    assert.equal(getChapterReading(book, fixture.chapter, other).available.length, 17);
    assert.equal(getChapterReading(book, fixture.chapter, other).entries.length, 20);
  }
  const modified = structuredClone(fixture.chapter);
  modified.verses[0].text += '!';
  assert.equal(getChapterReading(book, modified, source).entries.length, 20);
  const renamed = { ...book, name: 'Genesis' };
  assert.equal(getChapterReading(renamed, fixture.chapter, source).entries.length, 17);
});

test('full-pattern comparison normalizes whitespace and Unicode without changing text', () => {
  const chapter = structuredClone(fixture.chapter);
  chapter.verses[0].text = '  ' + chapter.verses[0].text.normalize('NFD').replaceAll(' ', '\n ') + '  ';
  assert.equal(getChapterReading(book, chapter, source).entries.length, 17);
  assert.equal(chapter.verses[0].text.startsWith('  '), true);
});

test('explicit ranges cover their last verse and preserve empty placeholders as provenance', () => {
  const chapter = make([
    { number: '14—15', text: 'Combined' },
    { number: '15', text: '' },
    { number: '16', text: 'Next' },
  ]);
  const reading = getChapterReading(book, chapter);
  assert.equal(reading.entries.length, 2);
  const result = resolveReadingReference(reading, ['15-16']);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.covered, [14, 15, 16]);
  assert.equal(reading.entries[0].records.length, 2);
});

test('empty records never authorize a guessed merge, even at chapter boundaries', () => {
  const chapter = make([
    { number: '1', text: '' },
    { number: '2', text: 'Two' },
    { number: '3', text: '' },
    { number: '4', text: '' },
  ]);
  const reading = getChapterReading(book, chapter);
  assert.equal(reading.entries.length, 4);
  assert.equal(resolveReadingReference(reading, ['3']).status, 'unresolved');
  assert.equal(resolveReadingReference(reading, ['1-4']).status, 'partial');
  assert.deepEqual(createScriptureSlides(book, chapter, ['1-4'], config), []);
});

test('overlaps and duplicates disable affected units but preserve unrelated text', () => {
  for (const verses of [
    [
      { number: '14-15', text: 'Combined' },
      { number: '15', text: 'Separate' },
    ],
    [
      { number: '14-16', text: 'Combined' },
      { number: '16-18', text: 'Other range' },
    ],
    [
      { number: '14', text: 'Same' },
      { number: '14', text: 'Same' },
    ],
    [
      { number: '14', text: 'Same' },
      { number: '14', text: '' },
    ],
  ]) {
    const chapter = make([...verses, { number: '20', text: 'Unrelated' }]);
    const reading = getChapterReading(book, chapter);
    assert.equal(reading.entries.filter((entry) => entry.issue === 'conflict').length, 2);
    assert.equal(resolveReadingReference(reading, ['14']).status, 'unresolved');
    assert.equal(resolveReadingReference(reading, ['20']).status, 'complete');
    assert.equal(new Set(reading.entries.map((entry) => entry.id)).size, 3);
  }
});

test('partial and discontinuous requests use exact sets, not a min/max envelope', () => {
  const reading = getChapterReading(book, fixture.chapter, source);
  const range = resolveReadingReference(reading, ['15-18']);
  assert.deepEqual(range.covered, [14, 15, 16, 17, 18]);
  const chosen = resolveReadingReference(reading, ['15', '18']);
  assert.equal(
    formatVerseNumbers(
      selectedReadingNumbers(
        reading,
        chosen.entries.map((entry) => entry.id)
      )
    ),
    '14–15, 17–18'
  );
  const slides = createScriptureSlides(book, fixture.chapter, ['15', '18'], config, source);
  assert.equal(slides.length, 1);
  assert.match(slides[0], /^Yaratılış 23:14–15, 17–18/);
  assert.equal(slides[0].includes('16.'), false);
  const partial = getChapterReading(
    book,
    make([
      { number: '14', text: 'A' },
      { number: '18', text: 'B' },
    ])
  );
  assert.deepEqual(resolveReadingReference(partial, ['14-18']).missing, [15, 16, 17]);
});

test('unsupported or invalid labels are never silently reduced to their first number', () => {
  for (const label of ['14a', '14b', '0', '18-14', '1-100000', '9007199254740992'])
    assert.deepEqual(parseVerseNumbers(label), []);
  assert.equal(formatVerseNumbers(['14a', '16']), '16');
  const reading = getChapterReading(
    book,
    make([
      { number: '14a', text: 'A' },
      { number: '16', text: 'B' },
    ])
  );
  assert.equal(reading.entries[0].issue, 'unsupported');
  assert.equal(resolveReadingReference(reading, ['14a', '16']).status, 'partial');
});

test('phone uses the same bridge resolution and rejects missing interiors and conflicts', () => {
  bibleRepository.remember({ name: 'Fixture', format: 'holyBible', books: [book] }, source);
  const result = resolveQuickVerse('Yaratılış 23:15');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.result.resolvedReference, 'Yaratılış 23:14–15');
    assert.equal(result.result.expanded, true);
  }
  assert.equal(resolveQuickVerse('Yaratılış 23:15—').ok, false);
  const chapter = make([
    { number: '14', text: 'A' },
    { number: '18', text: 'B' },
  ]);
  bibleRepository.remember({ name: 'Fixture', format: 'holyBible', books: [{ ...book, chapters: [chapter] }] }, source);
  assert.deepEqual(resolveQuickVerse('Yaratılış 3:14-18'), { ok: false, error: 'partial', numbers: '15–17' });
  const conflict = make([
    { number: '14-15', text: 'Combined' },
    { number: '15', text: 'Separate' },
    { number: '16', text: 'Usable' },
  ]);
  bibleRepository.remember({ name: 'Fixture', format: 'holyBible', books: [{ ...book, chapters: [conflict] }] }, source);
  assert.deepEqual(resolveQuickVerse('Yaratılış 3:15-16'), { ok: false, error: 'conflict', numbers: '15' });
  assert.equal(resolveQuickVerse('Yaratılış 3:16').ok, true);
});

test('suggestions keep requested numbers and search indexes only one combined unit', () => {
  const suggestion = buildReferenceSuggestions([book], 'Yaratılış 23:15', [], source)[0];
  assert.deepEqual(suggestion.verseNumbers, ['15']);
  const indexer = createBibleSearchIndexer(
    { name: 'Fixture', format: 'holyBible', books: [book] },
    (text) => text.split(/\s+/),
    source
  );
  while (!indexer.step(10)) {
    /* bounded indexer */
  }
  const found = indexer.index.get('Efron,')!;
  assert.equal(found.length, 1);
  const entry = getChapterReading(book, fixture.chapter, source).available.find(
    (entry) => entry.id === found[0].entryId
  )!;
  assert.equal(entry.number, '14–15');
});
