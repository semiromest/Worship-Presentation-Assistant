import type { MediaItem, MediaKind } from './types';

// Pure helpers for the Media page (MediaLoopTab.tsx): filtering, sorting,
// virtual-grid geometry and list reordering. Kept free of React/DOM so they
// can be unit tested and reused without mounting the page.

export type MediaFilter = 'all' | MediaKind;
export type MediaSort = 'added' | 'name' | 'type';
export type MediaDensity = 'compact' | 'comfortable';

export interface MediaViewPrefs {
  filter: MediaFilter;
  sort: MediaSort;
  density: MediaDensity;
}

export const DEFAULT_MEDIA_VIEW: MediaViewPrefs = { filter: 'all', sort: 'added', density: 'comfortable' };

const FILTERS: readonly MediaFilter[] = ['all', 'image', 'video'];
const SORTS: readonly MediaSort[] = ['added', 'name', 'type'];
const DENSITIES: readonly MediaDensity[] = ['compact', 'comfortable'];

/** Accept only known values so stale or hand-edited storage never breaks the page. */
export function parseMediaViewPrefs(raw: unknown): MediaViewPrefs {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    filter: FILTERS.includes(value.filter as MediaFilter) ? (value.filter as MediaFilter) : DEFAULT_MEDIA_VIEW.filter,
    sort: SORTS.includes(value.sort as MediaSort) ? (value.sort as MediaSort) : DEFAULT_MEDIA_VIEW.sort,
    density: DENSITIES.includes(value.density as MediaDensity) ? (value.density as MediaDensity) : DEFAULT_MEDIA_VIEW.density,
  };
}

export function countMediaByType(items: readonly MediaItem[]): Record<MediaFilter, number> {
  let image = 0;
  for (const item of items) if (item.type === 'image') image++;
  return { all: items.length, image, video: items.length - image };
}

/** Case- and accent-insensitive key for search matching. */
export function searchKey(value: string, locale?: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase(locale);
}

/** Sort a library without filtering it (used for selection order). */
export function sortMedia(items: readonly MediaItem[], sort: MediaSort, locale?: string): MediaItem[] {
  if (sort === 'added') return items.slice();
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const byName = (a: MediaItem, b: MediaItem) => collator.compare(a.name, b.name);
  return items.slice().sort(sort === 'name' ? byName : (a, b) => (a.type === b.type ? byName(a, b) : a.type === 'image' ? -1 : 1));
}

export function filterAndSortMedia(
  items: readonly MediaItem[],
  { query, filter, sort }: { query: string; filter: MediaFilter; sort: MediaSort },
  locale?: string
): MediaItem[] {
  const terms = searchKey(query.trim(), locale).split(/\s+/).filter(Boolean);
  const matches = items.filter((item) => {
    if (filter !== 'all' && item.type !== filter) return false;
    if (!terms.length) return true;
    const name = searchKey(item.name, locale);
    return terms.every((term) => name.includes(term));
  });
  return sortMedia(matches, sort, locale);
}

// ─── Virtual grid geometry ──────────────────────────────────────────────────

export const GRID_GAP = 12;
export const CARD_META_HEIGHT = 48;
export const MIN_CARD_WIDTH: Record<MediaDensity, number> = { compact: 168, comfortable: 248 };

export interface GridMetrics {
  cols: number;
  cardWidth: number;
  previewHeight: number;
  cardHeight: number;
  rowHeight: number;
}

/** Columns fill the width; every card keeps a 16:9 preview plus a fixed meta row. */
export function computeGridMetrics(containerWidth: number, density: MediaDensity, gap = GRID_GAP): GridMetrics {
  const width = Math.max(0, containerWidth);
  const min = MIN_CARD_WIDTH[density];
  const cols = width > 0 ? Math.max(1, Math.floor((width + gap) / (min + gap))) : 1;
  const cardWidth = width > 0 ? (width - gap * (cols - 1)) / cols : min;
  const previewHeight = Math.round((cardWidth * 9) / 16);
  const cardHeight = previewHeight + CARD_META_HEIGHT;
  return { cols, cardWidth, previewHeight, cardHeight, rowHeight: cardHeight + gap };
}

export function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscanRows: number
): { startRow: number; endRow: number } {
  if (totalRows <= 0 || rowHeight <= 0) return { startRow: 0, endRow: -1 };
  const rawStart = Math.floor(scrollTop / rowHeight) - overscanRows;
  const rawEnd = Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows;
  return { startRow: Math.max(0, rawStart), endRow: Math.min(totalRows - 1, Math.max(0, rawEnd)) };
}

// ─── Lists ──────────────────────────────────────────────────────────────────

/** Move one entry; out-of-range or no-op moves return the same array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Ids between two anchors (inclusive) in display order, for shift-click selection. */
export function rangeIds(ordered: readonly { id: string }[], fromId: string, toId: string): string[] {
  const a = ordered.findIndex((item) => item.id === fromId);
  const b = ordered.findIndex((item) => item.id === toId);
  if (a < 0 || b < 0) return b >= 0 ? [toId] : [];
  const [start, end] = a <= b ? [a, b] : [b, a];
  return ordered.slice(start, end + 1).map((item) => item.id);
}

export function formatLoopTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function clampDurationSecs(value: string | number): number {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 300) return 300;
  return Math.round(n);
}
