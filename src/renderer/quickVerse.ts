import { bibleRepository } from './bibleRepository';
import { createScriptureSlides, findBookForReference, parseScriptureReference } from './scriptureModel';

const CHUNK_CONFIG = { maxVerses: 3, maxChars: 120, maxLines: 2 } as const;

export interface QuickVerseResult {
  slides: string[];
  groupTitle: string;
}

export type QuickVerseError = 'no-bible' | 'invalid' | 'not-found' | 'no-verses';

export type QuickVerseOutcome =
  | { ok: true; result: QuickVerseResult }
  | { ok: false; error: QuickVerseError };

/**
 * Resolve a free-text reference (e.g. "John 3:16", "Rom 1:1-5") against the
 * Bible that is currently loaded, without any book/version picker. Returns the
 * ready-to-append slide chunks plus a group title, or a typed error the phone
 * UI can surface.
 */
export function resolveQuickVerse(reference: string): QuickVerseOutcome {
  const bible = bibleRepository.currentBible;
  if (!bible) return { ok: false, error: 'no-bible' };

  const parsed = parseScriptureReference(reference);
  if (!parsed || parsed.chapter == null || parsed.verse == null) {
    return { ok: false, error: 'invalid' };
  }

  const book = findBookForReference(bible.books, parsed.book);
  if (!book) return { ok: false, error: 'not-found' };

  const chapter = book.chapters.find((item) => Number(item.number) === parsed.chapter);
  if (!chapter) return { ok: false, error: 'not-found' };

  const verseTo = parsed.verseTo ?? parsed.verse;
  if (parsed.verse < 1 || verseTo < parsed.verse || /[:–-]\s*$/.test(reference)) {
    return { ok: false, error: 'invalid' };
  }
  if (!chapter.verses.some((verse) => Number(verse.number) === parsed.verse) ||
      !chapter.verses.some((verse) => Number(verse.number) === verseTo)) {
    return { ok: false, error: 'no-verses' };
  }
  const verseNumbers = chapter.verses
    .filter((verse) => {
      const number = Number(verse.number);
      return number >= parsed.verse! && number <= verseTo;
    })
    .map((verse) => verse.number);
  if (!verseNumbers.length) return { ok: false, error: 'no-verses' };

  const slides = createScriptureSlides(book, chapter, verseNumbers, CHUNK_CONFIG);
  if (!slides.length) return { ok: false, error: 'no-verses' };

  return {
    ok: true,
    result: {
      slides,
      groupTitle: `${book.name} ${chapter.number}`,
    },
  };
}

/** Human-readable reference for a resolved quick verse, used in operator feedback. */
export function describeQuickVerseError(error: QuickVerseError): string {
  switch (error) {
    case 'no-bible':
      return 'No Bible loaded';
    case 'not-found':
      return 'Reference not found';
    case 'no-verses':
      return 'No verses matched';
    default:
      return 'Invalid reference';
  }
}
