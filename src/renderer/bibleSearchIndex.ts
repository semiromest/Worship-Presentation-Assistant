import type { BibleData } from './bibleParser';

export interface VerseLocation {
  bookIndex: number;
  chapterIndex: number;
  verseIndex: number;
}

export type BibleSearchIndex = Map<string, VerseLocation[]>;

/**
 * Builds the full-text index a bounded number of verses at a time. Keeping the
 * cursor outside React lets the renderer yield between chunks instead of
 * blocking navigation while all ~31,000 verses are tokenized in one render.
 */
export function createBibleSearchIndexer(
  bible: BibleData,
  tokenize: (text: string) => string[]
): { index: BibleSearchIndex; step: (maxVerses?: number) => boolean } {
  const index: BibleSearchIndex = new Map();
  let bookIndex = 0;
  let chapterIndex = 0;
  let verseIndex = 0;

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
      if (verseIndex >= chapter.verses.length) {
        chapterIndex += 1;
        verseIndex = 0;
        continue;
      }

      const location = { bookIndex, chapterIndex, verseIndex };
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

        const verse = bible.books[location.bookIndex].chapters[location.chapterIndex].verses[location.verseIndex];
        const words = new Set(tokenize(verse.text));
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
