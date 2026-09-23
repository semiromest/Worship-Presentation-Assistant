import type { BibleBook, Chapter, Verse } from './bibleParser';

export interface ParsedScriptureReference {
  book: string;
  chapter: number | null;
  verse: number | null;
  verseTo: number | null;
}

export interface BibleSelection {
  book: BibleBook;
  chapter: Chapter;
  verseNumbers: string[];
}

export interface ReferenceSuggestion {
  id: string;
  label: string;
  detail: string;
  book: BibleBook;
  chapter?: Chapter;
  verseNumbers?: string[];
  kind: 'book' | 'reference' | 'recent';
}

export interface RecentScriptureReference {
  label: string;
  bookNumber: string;
  chapterNumber: string;
  verseNumbers: string[];
  usedAt: number;
}

const TURKISH_CHARS_MAP: Record<string, string> = {
  ı: 'i',
  ğ: 'g',
  ü: 'u',
  ş: 's',
  ö: 'o',
  ç: 'c',
};

const RECENTS_KEY = 'scriptureRecents:v1';
const MAX_RECENTS = 8;

export function normalizeScriptureText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ığüşöç]/g, (char) => TURKISH_CHARS_MAP[char] || char);
}

export function tokenizeScriptureText(value: string): string[] {
  return normalizeScriptureText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function parseScriptureReference(input: string): ParsedScriptureReference | null {
  const value = input.trim();
  if (!value) return null;

  const patterns = [/^(.+?)\s+(\d+):(\d*)(?:[-–](\d*))?$/, /^(.+?)\s+(\d+)$/, /^(.+?)$/];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const verse = match[3] ? Number.parseInt(match[3], 10) : null;
    return {
      book: normalizeScriptureText(match[1]),
      chapter: match[2] ? Number.parseInt(match[2], 10) : null,
      verse,
      verseTo: match[4] ? Number.parseInt(match[4], 10) : verse,
    };
  }
  return null;
}

export function findBookForReference(books: BibleBook[], bookQuery: string): BibleBook | null {
  const normalized = normalizeScriptureText(bookQuery);
  const exact = books.find((book) => normalizeScriptureText(book.name) === normalized);
  if (exact) return exact;
  const matches = filterBooksForReference(books, bookQuery);
  return matches.length === 1 ? matches[0] : null;
}

export function filterBooksForReference(books: BibleBook[], query: string): BibleBook[] {
  const parsed = parseScriptureReference(query);
  const bookQuery = parsed?.book ?? normalizeScriptureText(query.trim());
  if (!bookQuery) return books;
  return books.filter((book) => normalizeScriptureText(book.name).includes(bookQuery));
}

export function splitBibleTestaments(books: BibleBook[]): { oldTestament: BibleBook[]; newTestament: BibleBook[] } {
  let newTestamentIndex = books.findIndex((book) => Number.parseInt(book.number, 10) === 40);
  if (newTestamentIndex < 0) {
    const names = ['matta', 'matthew', 'mateo', 'matthaus', '마태'];
    newTestamentIndex = books.findIndex((book) => {
      const normalized = normalizeScriptureText(book.name);
      return names.some((name) => normalized.startsWith(name));
    });
  }
  if (newTestamentIndex < 0) return { oldTestament: books, newTestament: [] };
  return {
    oldTestament: books.slice(0, newTestamentIndex),
    newTestament: books.slice(newTestamentIndex),
  };
}

export function formatVerseNumbers(numbers: Iterable<string>): string {
  const sorted = [...new Set([...numbers].map((number) => Number.parseInt(number, 10)).filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
  if (sorted.length === 0) return '';

  const ranges: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${start}–${previous}`);
    start = current;
    previous = current;
  }
  return ranges.join(', ');
}

export function createScriptureSlides(
  book: BibleBook,
  chapter: Chapter,
  verseNumbers: Iterable<string>,
  config: { maxVerses: number; maxChars: number; maxLines: number }
): string[] {
  const wanted = new Set(verseNumbers);
  const verses = chapter.verses
    .filter((verse) => wanted.has(verse.number))
    .sort((a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10));

  const chunks: Verse[][] = [];
  let current: Verse[] = [];
  let currentChars = 0;
  for (const verse of verses) {
    const line = `${verse.number}. ${verse.text}`;
    const nextChars = currentChars + (current.length ? 2 : 0) + line.length;
    if (
      current.length > 0 &&
      (current.length >= config.maxVerses || current.length + 1 > config.maxLines || nextChars > config.maxChars)
    ) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(verse);
    currentChars += (current.length > 1 ? 2 : 0) + line.length;
  }
  if (current.length) chunks.push(current);

  return chunks.map((chunk) => {
    const reference = `${book.name} ${chapter.number}:${formatVerseNumbers(chunk.map((verse) => verse.number))}`;
    return `${reference}\n\n${chunk.map((verse) => `${verse.number}. ${verse.text}`).join('\n\n')}`;
  });
}

export function buildReferenceSuggestions(
  books: BibleBook[],
  query: string,
  recents: RecentScriptureReference[]
): ReferenceSuggestion[] {
  const normalized = normalizeScriptureText(query.trim());
  if (!normalized) {
    return recents.reduce<ReferenceSuggestion[]>((suggestions, recent) => {
      const book = books.find((candidate) => candidate.number === recent.bookNumber);
      const chapter = book?.chapters.find((candidate) => candidate.number === recent.chapterNumber);
      if (!book || !chapter) return suggestions;
      suggestions.push({
        id: `recent:${recent.label}`,
        label: recent.label,
        detail: book.name,
        book,
        chapter,
        verseNumbers: recent.verseNumbers,
        kind: 'recent' as const,
      });
      return suggestions;
    }, []);
  }

  const parsed = parseScriptureReference(query);
  const matchedBooks = books
    .filter((book) => normalizeScriptureText(book.name).includes(parsed?.book ?? normalized))
    .slice(0, 8);

  return matchedBooks.flatMap((book) => {
    const items: ReferenceSuggestion[] = [
      { id: `book:${book.number}`, label: book.name, detail: `${book.chapters.length}`, book, kind: 'book' },
    ];
    if (parsed?.chapter != null) {
      const chapter = book.chapters.find((candidate) => Number.parseInt(candidate.number, 10) === parsed.chapter);
      if (chapter) {
        const verseNumbers =
          parsed.verse != null
            ? chapter.verses
                .filter((verse) => {
                  const number = Number.parseInt(verse.number, 10);
                  return number >= parsed.verse! && number <= (parsed.verseTo ?? parsed.verse!);
                })
                .map((verse) => verse.number)
            : [];
        const suffix = verseNumbers.length ? `:${formatVerseNumbers(verseNumbers)}` : '';
        items.unshift({
          id: `reference:${book.number}:${chapter.number}:${suffix}`,
          label: `${book.name} ${chapter.number}${suffix}`,
          detail: verseNumbers.length ? `${verseNumbers.length}` : `${chapter.verses.length}`,
          book,
          chapter,
          verseNumbers,
          kind: 'reference',
        });
      }
    }
    return items;
  });
}

function readRecentMap(): Record<string, RecentScriptureReference[]> {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '{}') as Record<string, RecentScriptureReference[]>;
  } catch {
    return {};
  }
}

export function getRecentScriptureReferences(sourceId: string): RecentScriptureReference[] {
  return readRecentMap()[sourceId] ?? [];
}

export function saveRecentScriptureReference(sourceId: string, selection: BibleSelection): RecentScriptureReference[] {
  const map = readRecentMap();
  const label = `${selection.book.name} ${selection.chapter.number}:${formatVerseNumbers(selection.verseNumbers)}`;
  const next: RecentScriptureReference = {
    label,
    bookNumber: selection.book.number,
    chapterNumber: selection.chapter.number,
    verseNumbers: selection.verseNumbers,
    usedAt: Date.now(),
  };
  map[sourceId] = [next, ...(map[sourceId] ?? []).filter((item) => item.label !== label)].slice(0, MAX_RECENTS);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(map));
  return map[sourceId];
}
