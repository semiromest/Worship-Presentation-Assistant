import type { BibleSourceDescriptor } from './bibleRepository';
import { getChapterReading } from './scriptureReading';
import type { BibleData } from './bibleParser';

export interface VerseLocation {
  bookIndex: number;
  chapterIndex: number;
  entryId: string;
}

export type BibleSearchIndex = Map<string, VerseLocation[]>;

/**
 * Builds the full-text index a bounded number of verses at a time. Keeping the
 * cursor outside React lets the renderer yield between chunks instead of
 * blocking navigation while all ~31,000 verses are tokenized in one render.
 */
export function createBibleSearchIndexer(
  bible: BibleData,
  tokenize: (text: string) => string[],
  source?: BibleSourceDescriptor | null
): { index: BibleSearchIndex; step: (maxVerses?: number) => boolean } {
  const index: BibleSearchIndex = new Map();
  let bookIndex = 0;
  let chapterIndex = 0;
  let verseIndex = 0;
  let currentText = '';
  // Prepare the first chapter's reading view before the bounded indexing steps.
  // Subsequent real chapters are small and are prepared when the cursor enters them.
  const firstBook = bible.books[0];
  if (firstBook?.chapters[0]) getChapterReading(firstBook, firstBook.chapters[0], source);

  const nextVerse = (): VerseLocation | null => {
    while (bookIndex < bible.books.length) {
      const book = bible.books[bookIndex];
      if (chapterIndex >= book.chapters.length) {
        bookIndex += 1;
        chapterIndex = 0;
        verseIndex = 0;
        continue;
      }

      const chapter = book.chapters[chapterIndex];
      const reading = getChapterReading(book, chapter, source);
      if (verseIndex >= reading.available.length) {
        chapterIndex += 1;
        verseIndex = 0;
        continue;
      }

      const location = { bookIndex, chapterIndex, entryId: reading.available[verseIndex].id };
      currentText = reading.available[verseIndex].text;
      verseIndex += 1;
      return location;
    }

    return null;
  };

  return {
    index,
    step(maxVerses = 160) {
      let processed = 0;
      while (processed < maxVerses) {
        const location = nextVerse();
        if (!location) return true;

        const words = new Set(tokenize(currentText));
        for (const word of words) {
          if (word.length < 2) continue;
          const entries = index.get(word);
          if (entries) entries.push(location);
          else index.set(word, [location]);
        }
        processed += 1;
      }

      return false;
    },
  };
}
