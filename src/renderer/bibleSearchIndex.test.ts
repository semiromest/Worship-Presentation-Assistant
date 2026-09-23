import assert from 'node:assert/strict';
import test from 'node:test';
import type { BibleData } from './bibleParser';
import { createBibleSearchIndexer } from './bibleSearchIndex';

const bible: BibleData = {
  name: 'Test',
  format: 'zefania',
  books: [
    {
      name: 'Book',
      number: '1',
      chapters: [
        {
          number: '1',
          verses: [
            { number: '1', text: 'Grace and peace' },
            { number: '2', text: 'Grace upon grace' },
            { number: '3', text: 'Hope' },
          ],
        },
      ],
    },
  ],
};

test('Bible search indexer yields between bounded chunks and keeps unique verse entries', () => {
  const indexer = createBibleSearchIndexer(bible, (text) => text.toLowerCase().split(/\s+/));

  assert.equal(indexer.step(1), false);
  assert.deepEqual(indexer.index.get('grace'), [{ bookIndex: 0, chapterIndex: 0, verseIndex: 0 }]);

  assert.equal(indexer.step(1), false);
  assert.equal(indexer.index.get('grace')?.length, 2);

  assert.equal(indexer.step(10), true);
  assert.deepEqual(indexer.index.get('hope'), [{ bookIndex: 0, chapterIndex: 0, verseIndex: 2 }]);
});

test('31,000 verses are indexed in batches no larger than 160 verses', () => {
  const syntheticBible: BibleData = {
    name: 'Synthetic',
    format: 'zefania',
    books: [
      {
        name: 'Book',
        number: '1',
        chapters: [
          {
            number: '1',
            verses: Array.from({ length: 31_000 }, (_, index) => ({
              number: String(index + 1),
              text: `shared token unique${index}`,
            })),
          },
        ],
      },
    ],
  };
  const indexer = createBibleSearchIndexer(syntheticBible, (text) => text.toLowerCase().split(/\s+/));
  let steps = 0;
  let done = false;
  let longestBatchMs = 0;

  while (!done) {
    const startedAt = performance.now();
    done = indexer.step(160);
    longestBatchMs = Math.max(longestBatchMs, performance.now() - startedAt);
    steps += 1;
  }

  assert.equal(steps, Math.ceil(31_000 / 160));
  assert.ok(longestBatchMs < 50, `expected every indexing batch below 50 ms, saw ${longestBatchMs.toFixed(1)} ms`);
  assert.equal(indexer.index.get('shared')?.length, 31_000);
  assert.deepEqual(indexer.index.get('unique30999'), [{ bookIndex: 0, chapterIndex: 0, verseIndex: 30_999 }]);
});
