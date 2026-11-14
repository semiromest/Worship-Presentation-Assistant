import { getChapterReading, resolveReadingReference, parseVerseNumbers } from './scriptureReading';
import { bibleRepository } from './bibleRepository';
import {
  chapterVerseNumbers,
  createScriptureSlides,
  findBookForReference,
  parseScriptureReference,
  formatVerseNumbers,
} from './scriptureModel';

const CHUNK_CONFIG = { maxVerses: 3, maxChars: 120, maxLines: 2 } as const;

export interface QuickVerseResult {
  slides: string[];
  groupTitle: string;
  requestedReference: string;
  resolvedReference: string;
  expanded: boolean;
}

export type QuickVerseError = 'no-bible' | 'invalid' | 'not-found' | 'no-verses' | 'partial' | 'conflict';

export type QuickVerseOutcome =
  | { ok: true; result: QuickVerseResult }
  | { ok: false; error: QuickVerseError; numbers?: string };

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
  if (!parsed || parsed.chapter == null || (parsed.verse == null && !parsed.wholeChapter)) {
    return { ok: false, error: 'invalid' };
  }

  const book = findBookForReference(bible.books, parsed.book);
  if (!book) return { ok: false, error: 'not-found' };

  const chapter = book.chapters.find((item) => Number(item.number) === parsed.chapter);
  if (!chapter) return { ok: false, error: 'not-found' };

  const source = bibleRepository.currentSource;
  const reading = getChapterReading(book, chapter, source);
  let verseNumbers: string[];
  if (parsed.wholeChapter) {
    // "Yuhanna 1::" — every verse of the chapter.
    verseNumbers = chapterVerseNumbers(reading);
    if (!verseNumbers.length) return { ok: false, error: 'no-verses' };
  } else {
    const verse = parsed.verse as number;
    const verseTo = parsed.verseTo ?? verse;
    if (verse < 1 || verseTo < verse || /[:–—-]\s*$/.test(reference)) {
      return { ok: false, error: 'invalid' };
    }
    verseNumbers = parseVerseNumbers(verse + '-' + verseTo).map(String);
  }
  const resolution = resolveReadingReference(reading, verseNumbers);
  if (resolution.status !== 'complete')
    return {
      ok: false,
      error: resolution.conflicts.length ? 'conflict' : resolution.entries.length ? 'partial' : 'no-verses',
      numbers: formatVerseNumbers(resolution.missing.map(String)),
    };
  const slides = createScriptureSlides(book, chapter, verseNumbers, CHUNK_CONFIG, source);
  if (!slides.length) return { ok: false, error: 'no-verses' };

  return {
    ok: true,
    result: {
      slides,
      requestedReference: reference,
      expanded: resolution.covered.some((number) => !resolution.requested.includes(number)),
      resolvedReference: `${book.name} ${chapter.number}:${formatVerseNumbers(resolution.covered.map(String))}`,
      groupTitle: `${book.name} ${chapter.number}`,
    },
  };
}

/** Human-readable reference for a resolved quick verse, used in operator feedback. */
export function describeQuickVerseError(error: QuickVerseError): string {
  switch (error) {
    case 'partial':
      return 'Incomplete verse range';
    case 'conflict':
      return 'Conflicting verse records';
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
