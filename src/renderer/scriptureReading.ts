import type { BibleBook, Chapter, Verse } from './bibleParser';
import type { BibleSourceDescriptor } from './bibleRepository';
import verified from './verifiedGenesis23.json';

export interface ReadingEntry {
  id: string;
  number: string;
  text: string;
  numbers: number[];
  records: readonly Verse[];
  evidence?: 'source-range' | 'verified-rule';
  ruleId?: string;
  verificationUrl?: string;
  issue?: 'empty' | 'unsupported' | 'conflict';
}
export interface ChapterReading {
  entries: ReadingEntry[];
  available: ReadingEntry[];
}
export interface ReferenceResolution {
  status: 'complete' | 'partial' | 'unresolved';
  requested: number[];
  entries: ReadingEntry[];
  covered: number[];
  missing: number[];
  conflicts: number[];
  unsupported: string[];
}

const RULE_VERSION = 1;
const cache = new WeakMap<Chapter, Map<string, ChapterReading>>();
const comparable = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** Strictly parse supported source labels; never interpret 14a as 14. */
export function parseVerseNumbers(label: string): number[] {
  const match = label.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/u);
  if (!match) return [];
  const start = Number(match[1]),
    end = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 1000)
    return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function getChapterReading(
  book: BibleBook,
  chapter: Chapter,
  source?: BibleSourceDescriptor | null
): ChapterReading {
  const scope = JSON.stringify([RULE_VERSION, source?.type, source?.id, source?.revision, book.number, chapter.number]);
  let byScope = cache.get(chapter);
  const cached = byScope?.get(scope);
  if (cached) return cached;
  const entries: ReadingEntry[] = chapter.verses.map((record, index) => {
    const numbers = parseVerseNumbers(record.number);
    return {
      id: `${scope}:${index}`,
      number: numbers.length > 1 ? `${numbers[0]}–${numbers.at(-1)}` : record.number,
      text: record.text,
      numbers,
      records: [record],
      evidence: numbers.length > 1 ? 'source-range' : undefined,
      issue: !numbers.length ? 'unsupported' : !record.text.trim() ? 'empty' : undefined,
    };
  });

  // Match the entire reviewed chapter, never a title, language, or empty neighbour.
  // A local file's identity is unknown; this rule proves only this chapter pattern.
  const compatibleSource =
    !source ||
    source.type === 'local' ||
    (source.type === 'online' && source.id === verified.sourceId && !source.revision);
  const exactPattern =
    compatibleSource &&
    book.number === verified.bookNumber &&
    chapter.number === verified.chapter.number &&
    chapter.verses.length === verified.chapter.verses.length &&
    chapter.verses.every((record, index) => {
      const expected = verified.chapter.verses[index];
      return record.number === expected.number && comparable(record.text) === comparable(expected.text);
    });
  if (exactPattern) {
    for (const [start, end] of verified.ranges) {
      const head = entries.find((entry) => entry.number === String(start));
      const tail = entries.find((entry) => entry.number === String(end));
      if (!head || !tail || head.issue || tail.issue !== 'empty') continue;
      head.number = `${start}–${end}`;
      head.numbers = parseVerseNumbers(head.number);
      head.records = [...head.records, ...tail.records];
      head.evidence = 'verified-rule';
      head.ruleId = `beblia-turkish-genesis23-v${verified.version}`;
      head.verificationUrl = verified.provenance;
      entries.splice(entries.indexOf(tail), 1);
    }
  }
  const owners = new Map<number, ReadingEntry[]>();
  for (const entry of entries) {
    if (!entry.numbers.length) continue;
    if (
      entry.issue === 'empty' &&
      entries.some(
        (candidate) =>
          !candidate.issue && candidate.evidence && entry.numbers.every((n) => candidate.numbers.includes(n))
      )
    )
      continue;
    for (const number of entry.numbers) owners.set(number, [...(owners.get(number) ?? []), entry]);
  }
  for (const overlapping of owners.values()) {
    if (overlapping.length > 1) for (const entry of overlapping) entry.issue = 'conflict';
  }
  // Explicit ranges may have empty placeholder records; retain those in provenance.
  const visible = entries.filter((entry) => {
    if (entry.issue !== 'empty') return true;
    const parent = entries.find(
      (candidate) => !candidate.issue && candidate.evidence && entry.numbers.every((n) => candidate.numbers.includes(n))
    );
    if (!parent) return true;
    parent.records = [...parent.records, ...entry.records];
    return false;
  });
  const reading = { entries: visible, available: visible.filter((entry) => !entry.issue) };
  if (!byScope) {
    byScope = new Map();
    cache.set(chapter, byScope);
  }
  byScope.set(scope, reading);
  return reading;
}

export function resolveReadingReference(reading: ChapterReading, labels: Iterable<string>): ReferenceResolution {
  const input = [...labels];
  const requested = [...new Set(input.flatMap(parseVerseNumbers))].sort((a, b) => a - b);
  const entries = reading.available
    .filter((entry) => entry.numbers.some((n) => requested.includes(n)))
    .sort((a, b) => a.numbers[0] - b.numbers[0]);
  const covered = [...new Set(entries.flatMap((entry) => entry.numbers))].sort((a, b) => a - b);
  const missing = requested.filter((n) => !covered.includes(n));
  const conflicts = requested.filter((n) =>
    reading.entries.some((entry) => entry.issue === 'conflict' && entry.numbers.includes(n))
  );
  const unsupported = input.filter((label) => !parseVerseNumbers(label).length);
  return {
    status:
      requested.length && !missing.length && !unsupported.length
        ? 'complete'
        : entries.length
          ? 'partial'
          : 'unresolved',
    requested,
    entries,
    covered,
    missing,
    conflicts,
    unsupported,
  };
}

export function selectedReadingNumbers(reading: ChapterReading, ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return [...new Set(reading.available.filter((entry) => wanted.has(entry.id)).flatMap((entry) => entry.numbers))]
    .sort((a, b) => a - b)
    .map(String);
}
