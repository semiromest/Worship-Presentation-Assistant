import type { Hymn } from './hymnImport';

export type HymnSortOrder = 'original' | 'title-asc' | 'title-desc';
export function hymnSortOrder(value: string | null): HymnSortOrder {
  return value === 'title-asc' || value === 'title-desc' ? value : 'original';
}
export function sortHymns(hymns: Hymn[], order: HymnSortOrder, language: string): Hymn[] {
  if (order === 'original') return hymns;
  const collator = new Intl.Collator(language, { usage: 'sort', sensitivity: 'base', numeric: true });
  const direction = order === 'title-desc' ? -1 : 1;
  return hymns.map((hymn, index) => ({ hymn, index }))
    .sort((a, b) => direction * collator.compare(a.hymn.title, b.hymn.title) || a.index - b.index)
    .map(({ hymn }) => hymn);
}
export function firstHymnLine(lyrics: string): string {
  return lyrics.split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
}
