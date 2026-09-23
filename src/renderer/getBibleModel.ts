import type { BibleBook, BibleData, Chapter, Verse } from './bibleParser';

export interface GetBibleTranslation {
  translation: string;
  abbreviation: string;
  description: string;
  lang: string;
  language: string;
  direction: 'LTR' | 'RTL' | string;
  distribution_version?: string;
  distribution_version_date?: string;
  distribution_abbreviation?: string;
  distribution_about?: string;
  distribution_license?: string;
  distribution_source?: string;
  distribution_versification?: string;
  url: string;
  sha: string;
}

export interface GetBibleCatalog {
  translations: GetBibleTranslation[];
  total: number;
}

interface GetBibleVersePayload {
  chapter: number | string;
  verse: number | string;
  name?: string;
  text: string;
}

interface GetBibleChapterPayload {
  chapter: number | string;
  name?: string;
  verses: GetBibleVersePayload[];
}

interface GetBibleBookPayload {
  nr: number | string;
  name: string;
  chapters: GetBibleChapterPayload[];
}

export interface GetBiblePayload extends Partial<GetBibleTranslation> {
  books: GetBibleBookPayload[];
}

export function normalizeGetBibleCatalog(value: unknown): GetBibleCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid GetBible translation catalog');
  }

  const all = Object.values(value as Record<string, GetBibleTranslation>).filter((item): item is GetBibleTranslation =>
    Boolean(item && typeof item === 'object' && item.abbreviation && item.translation && item.url && item.sha)
  );
  return { translations: all, total: all.length };
}

export function convertGetBiblePayload(payload: GetBiblePayload): BibleData {
  if (!payload || !Array.isArray(payload.books)) throw new Error('Invalid GetBible Bible payload');

  const books: BibleBook[] = payload.books.map((book, bookIndex) => {
    if (!book || !Array.isArray(book.chapters)) throw new Error('Invalid GetBible book payload');
    const chapters: Chapter[] = book.chapters.map((chapter, chapterIndex) => {
      if (!chapter || !Array.isArray(chapter.verses)) throw new Error('Invalid GetBible chapter payload');
      const verses: Verse[] = chapter.verses.map((verse, verseIndex) => ({
        number: String(verse?.verse ?? verseIndex + 1),
        text: String(verse?.text ?? '').trim(),
      }));
      return { number: String(chapter.chapter ?? chapterIndex + 1), verses };
    });
    return {
      number: String(book.nr ?? bookIndex + 1),
      name: String(book.name || `Book ${bookIndex + 1}`),
      chapters,
    };
  });

  return {
    name: payload.translation || payload.description || payload.abbreviation || 'GetBible',
    books,
    format: 'getbible',
  };
}

export function parseGetBibleJson(text: string): BibleData {
  return convertGetBiblePayload(JSON.parse(text) as GetBiblePayload);
}
