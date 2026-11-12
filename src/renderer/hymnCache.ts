import type { Hymn } from './hymnImport';
import { mergeImportedHymns } from './hymnImport';

// Cache key version: v3 adds author/key/source metadata to cached entries,
// so older caches are invalidated and re-parsed on next launch.
export const CACHE_VERSION = 'v3';

export function cacheHymns(path: string, list: Hymn[]): void {
  try { localStorage.setItem(`hymnsCache:${CACHE_VERSION}:${path}`, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export function loadCachedHymns(path: string): Hymn[] | null {
  try {
    const raw = localStorage.getItem(`hymnsCache:${CACHE_VERSION}:${path}`);
    return raw ? (JSON.parse(raw) as Hymn[]) : null;
  } catch { return null; }
}

/** Hymn library as last persisted, readable without mounting the Hymns tab. */
export function loadLibraryHymns(): Hymn[] {
  let archivePath: string | null = null;
  try { archivePath = localStorage.getItem('defaultHymnArchivePath'); } catch { /* storage unavailable */ }
  const archive = archivePath ? loadCachedHymns(archivePath) ?? [] : [];
  return mergeImportedHymns(archive, loadCachedHymns('__online__') ?? []);
}

export function readHymnAddPreferences(): { partsMode: boolean; showAuthor: boolean } {
  const flag = (key: string) => {
    try { const v = localStorage.getItem(key); return v === null ? true : v === '1'; } catch { return true; }
  };
  return { partsMode: flag('hymnsPartsModeEnabled'), showAuthor: flag('hymnsShowAuthorOnSlides') };
}
