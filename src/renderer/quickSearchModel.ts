import type { BibleBook, BibleData, Chapter } from './bibleParser';
import type { BibleSourceDescriptor } from './bibleRepository';
import type { Hymn } from './hymnImport';
import type { MediaItem } from '../shared/presentation';
import { buildReferenceSuggestions, normalizeScriptureText } from './scriptureModel';
import { getChapterReading, resolveReadingReference } from './scriptureReading';

export const QUICK_SEARCH_LIMIT = 6;

export interface ScriptureHit {
  id: string;
  label: string;
  preview: string;
  book: BibleBook;
  chapter: Chapter;
  verseNumbers: string[];
}

function words(query: string): string[] {
  return normalizeScriptureText(query).split(/\s+/).filter(Boolean);
}

/** Verse references such as "yuhanna 3:16" or "mez 23:1-3"; chapter-only input is not addable. */
export function searchScripture(
  bible: BibleData | null,
  source: BibleSourceDescriptor | null,
  query: string,
  limit = QUICK_SEARCH_LIMIT
): ScriptureHit[] {
  if (!bible || !query.trim()) return [];
  const hits: ScriptureHit[] = [];
  for (const item of buildReferenceSuggestions(bible.books, query, [], source)) {
    if (item.kind !== 'reference' || !item.chapter || !item.verseNumbers?.length) continue;
    const resolution = resolveReadingReference(getChapterReading(item.book, item.chapter, source), item.verseNumbers);
    if (resolution.status !== 'complete' || !resolution.entries.length) continue;
    hits.push({
      id: item.id,
      label: item.label,
      preview: resolution.entries.map((entry) => entry.text).join(' '),
      book: item.book,
      chapter: item.chapter,
      verseNumbers: item.verseNumbers,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function searchHymns(hymns: Hymn[], query: string, limit = QUICK_SEARCH_LIMIT): Hymn[] {
  const terms = words(query);
  if (!terms.length) return [];
  const phrase = terms.join(' ');
  const ranked: Array<{ hymn: Hymn; score: number }> = [];
  for (const hymn of hymns) {
    const title = normalizeScriptureText(hymn.title);
    let score = 0;
    if (title.startsWith(phrase)) score = 3;
    else if (terms.every((term) => title.includes(term))) score = 2;
    else if (phrase.length >= 3 && terms.every((term) => normalizeScriptureText(hymn.lyrics).includes(term))) score = 1;
    if (score) ranked.push({ hymn, score });
  }
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.hymn);
}

export function searchMedia(items: MediaItem[], query: string, limit = QUICK_SEARCH_LIMIT): MediaItem[] {
  const terms = words(query);
  if (!terms.length) return [];
  return items
    .filter((item) => {
      const name = normalizeScriptureText(item.name);
      return terms.every((term) => name.includes(term));
    })
    .slice(0, limit);
}
